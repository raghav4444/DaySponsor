/**
 * A fake Supabase admin client for tests.
 *
 * `lib/server-supabase.ts` lazily builds a singleton from `SUPABASE_SERVICE_ROLE_KEY`. The
 * financial tests need that client to read and write without a database, so this module
 * swaps the getter for one backed by an in-memory store, and restores it afterwards.
 *
 * Only the query shapes the application actually uses are implemented:
 *  - `from(t).select(cols).eq(k,v).in(k,[]).order(...).limit(n).maybeSingle()`
 *  - `from(t).insert(row).select().single()`
 *  - `from(t).update(row).eq(k,v)`
 *  - `from(t).upsert(row, { onConflict, ignoreDuplicates })`
 *  - `rpc(name, args)`
 *
 * The store is deliberately naive — it is here to prove the application's *logic*, not
 * Postgres. Anything a real database would refuse (a duplicate insert, a missing row) is
 * accepted only when the caller explicitly says so, so a test cannot accidentally pass
 * against behaviour Postgres would have rejected.
 */

import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as serverSupabase from '@/lib/server-supabase';

type Row = Record<string, unknown>;

/** The in-memory tables the tests populate. */
export type FakeDatabase = Record<string, Row[]>;

/** Recorded RPC calls, keyed by function name. */
export type FakeRpcCalls = Record<string, unknown[]>;

export type FakeSupabaseState = {
  database: FakeDatabase;
  rpcCalls: FakeRpcCalls;
  /** RPC implementations a test installs. */
  rpcHandlers: Record<string, (args: unknown) => unknown>;
};

export function createFakeSupabaseState(): FakeSupabaseState {
  return { database: {}, rpcCalls: {}, rpcHandlers: {} };
}

export function installRpcHandler(
  state: FakeSupabaseState,
  name: string,
  handler: (args: unknown) => unknown,
) {
  state.rpcHandlers[name] = handler;
}

/** Set the database to a fresh state, seeded with the given tables. */
export function seedDatabase(state: FakeSupabaseState, tables: FakeDatabase) {
  state.database = {};
  for (const [table, rows] of Object.entries(tables)) {
    state.database[table] = rows.map((row) => ({ ...row }));
  }
  state.rpcCalls = {};
}

/**
 * Installs a fake admin client and returns a handle that restores the real one.
 *
 * Usage:
 *   const restore = installFakeAdminClient(state);
 *   try { ... } finally { restore(); }
 */
export function installFakeAdminClient(state: FakeSupabaseState): () => void {
  // A static import is safe: `getAdminClient` builds its singleton lazily, so importing
  // the module never contacts Supabase. The spy replaces the getter before any caller
  // reaches it.
  const getter = vi
    .spyOn(serverSupabase, 'getAdminClient')
    .mockReturnValue(buildFakeClient(state));

  return () => getter.mockRestore();
}

function buildFakeClient(state: FakeSupabaseState): SupabaseClient {
  const query = (table: string) => {
    const steps: QueryStep[] = [];
    const builder = {
      select: (columns?: string) => {
        steps.push({ kind: 'select', columns: columns ?? '*' });
        return builder;
      },
      eq: (column: string, value: unknown) => {
        steps.push({ kind: 'eq', column, value });
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        steps.push({ kind: 'in', column, values });
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        steps.push({ kind: 'order', column, ascending: options?.ascending ?? true });
        return builder;
      },
      limit: (n: number) => {
        steps.push({ kind: 'limit', n });
        return builder;
      },
      maybeSingle: () => run('maybeSingle'),
      single: () => run('single'),
      insert: (row: Row | Row[]) => {
        steps.push({ kind: 'insert', rows: Array.isArray(row) ? row : [row] });
        return builder;
      },
      update: (row: Row) => {
        steps.push({ kind: 'update', row });
        return builder;
      },
      upsert: (row: Row, options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        steps.push({
          kind: 'upsert',
          row,
          onConflict: options?.onConflict,
          ignoreDuplicates: options?.ignoreDuplicates ?? false,
        });
        return builder;
      },
    };

    const run = (terminal: 'maybeSingle' | 'single'): Promise<QueryResult> =>
      Promise.resolve(execute(state, table, steps, terminal));

    // `.update().eq().select()` chains a select after the write.
    return new Proxy(builder, {
      get(target, prop) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
        return target[prop as keyof typeof target];
      },
    });
  };

  const client = {
    from: query,
    rpc: (name: string, args: unknown) => {
      state.rpcCalls[name] = state.rpcCalls[name] ?? [];
      state.rpcCalls[name].push(args);
      const handler = state.rpcHandlers[name];
      if (handler) return Promise.resolve({ data: handler(args), error: null });
      return Promise.resolve({
        data: null,
        error: { code: 'PGRST202', message: `Could not find the function ${name}` },
      });
    },
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  } as unknown as SupabaseClient;

  return client;
}

type QueryStep =
  | { kind: 'select'; columns: string }
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] }
  | { kind: 'order'; column: string; ascending: boolean }
  | { kind: 'limit'; n: number }
  | { kind: 'insert'; rows: Row[] }
  | { kind: 'update'; row: Row }
  | {
      kind: 'upsert';
      row: Row;
      onConflict?: string;
      ignoreDuplicates: boolean;
    };

type QueryResult = { data: Row | Row[] | null; error: { code: string; message: string } | null };

function execute(
  state: FakeSupabaseState,
  table: string,
  steps: QueryStep[],
  terminal: 'maybeSingle' | 'single',
): QueryResult {
  state.database[table] = state.database[table] ?? [];

  let write: { kind: 'insert' | 'update' | 'upsert' } & {
    rows?: Row[];
    row?: Row;
    onConflict?: string;
    ignoreDuplicates?: boolean;
  } | null = null;

  for (const step of steps) {
    if (step.kind === 'insert' || step.kind === 'update' || step.kind === 'upsert') {
      write = step;
    }
  }

  const filters = steps.filter(
    (s): s is Extract<QueryStep, { kind: 'eq' | 'in' }> => s.kind === 'eq' || s.kind === 'in',
  );

  // --- writes -------------------------------------------------------------
  if (write) {
    if (write.kind === 'insert') {
      const insertedRows: Row[] = [];
      for (const row of write.rows ?? []) {
        const conflict = uniqueConflict(state, table, row);
        if (conflict) return { data: null, error: conflict };
        // Generate the columns the real database would: `profiles` and `creator_profiles`
        // both have `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, and every table has a
        // `created_at`. Without these a caller reading the id back gets undefined and the
        // lookup for the child row silently matches nothing.
        const stored = withGeneratedColumns(table, row);
        state.database[table].push(stored);
        insertedRows.push(stored);
      }
      // `.insert().select()` resolves to the *array* of stored rows — the real client
      // returns an array even after `.single()`, so callers must unwrap it. Mirroring
      // that shape here is what makes the fake able to catch an unwrapped read.
      return { data: insertedRows.length ? insertedRows : null, error: null };
    }

    if (write.kind === 'upsert') {
      const upsertRow = write.row ?? {};
      const conflictColumns = (write.onConflict ?? 'id').split(',').map((c) => c.trim());
      const existingIndex = state.database[table].findIndex((row) =>
        conflictColumns.every((col) => row[col] === upsertRow[col]),
      );
      if (existingIndex >= 0) {
        if (write.ignoreDuplicates) return { data: null, error: null };
        state.database[table][existingIndex] = { ...state.database[table][existingIndex], ...upsertRow };
        return { data: state.database[table][existingIndex], error: null };
      }
      state.database[table].push({ ...upsertRow });
      return { data: upsertRow, error: null };
    }

    // update
    const updateRow = write.row ?? {};
    let matched = 0;
    state.database[table] = state.database[table].map((row) => {
      if (matches(row, filters)) {
        matched += 1;
        return { ...row, ...updateRow };
      }
      return row;
    });
    if (matched === 0) {
      return {
        data: null,
        error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      };
    }
    return { data: null, error: null };
  }

  // --- reads --------------------------------------------------------------
  let rows = state.database[table].filter((row) => matches(row, filters));

  for (const step of steps) {
    if (step.kind === 'order') {
      rows = [...rows].sort((a, b) => {
        const av = a[step.column];
        const bv = b[step.column];
        if (typeof av === 'number' && typeof bv === 'number') {
          return step.ascending ? av - bv : bv - av;
        }
        return step.ascending
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }
    if (step.kind === 'limit') rows = rows.slice(0, step.n);
  }

  if (terminal === 'single') {
    if (rows.length === 0) {
      return {
        data: null,
        error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      };
    }
    return { data: rows[0], error: null };
  }

  return { data: rows[0] ?? null, error: null };
}

function matches(row: Row, filters: Extract<QueryStep, { kind: 'eq' | 'in' }>[]): boolean {
  return filters.every((filter) => {
    if (filter.kind === 'eq') return row[filter.column] === filter.value;
    return filter.values.includes(row[filter.column]);
  });
}

/** Tables with a generated `id` primary key (migration `20260903215330`). */
const TABLES_WITH_GENERATED_ID = new Set(['profiles', 'creator_profiles', 'days', 'sponsorships', 'reviews', 'deliverables', 'sponsorship_slots', 'webhook_events']);

/**
 * Fills in the columns Postgres generates on insert so a caller that reads the row back
 * sees what it would in production. Deterministic ids keep tests stable and readable.
 */
function withGeneratedColumns(table: string, row: Row): Row {
  const stored: Row = { ...row };
  if (TABLES_WITH_GENERATED_ID.has(table) && stored.id === undefined) {
    stored.id = `${table}-id-${statelessCounter(table)}`;
  }
  if (stored.created_at === undefined) {
    stored.created_at = '2026-01-01T00:00:00.000Z';
  }
  return stored;
}

const idCounters = new Map<string, number>();

function statelessCounter(table: string): number {
  const next = (idCounters.get(table) ?? 0) + 1;
  idCounters.set(table, next);
  return next;
}

/**
 * Tables whose uniqueness the fake enforces.
 *  - `stripe_webhook_events` has a unique constraint on `stripe_event_id` (contract §3.5): without it, a
 *    replayed delivery would look newly claimed and the idempotency guard would be
 *    untestable.
 *  - `profiles` has a unique `user_id` and `creator_profiles` a unique `profile_id`
 *    (migration `20260903215330`). Profile provisioning relies on this: without it, a
 *    retried signup or a returning Google user could not be distinguished from a first
 *    creation, and the duplicate-key recovery path would be unreachable.
 *
 * Returns the PostgREST error a duplicate insert would raise, or null when the row is new.
 */
function uniqueConflict(
  state: FakeSupabaseState,
  table: string,
  row: Row,
): { code: string; message: string } | null {
  const uniqueColumn: string | null =
    table === 'stripe_webhook_events'
      ? 'stripe_event_id'
      : table === 'profiles'
        ? 'user_id'
        : table === 'creator_profiles'
          ? 'profile_id'
          : null;

  if (!uniqueColumn) return null;
  const value = row[uniqueColumn];
  if (typeof value !== 'string') return null;
  const exists = state.database[table].some((existing) => existing[uniqueColumn] === value);
  return exists
    ? { code: '23505', message: 'duplicate key value violates unique constraint' }
    : null;
}
