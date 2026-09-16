# DaySponsor — Stripe & UI Implementation Findings (Phase 1)

> Engineer B inspection report. Documents the **existing** application before any change,
> so that the Stripe/auction work preserves its conventions rather than redesigning it.
>
> Inspection date: 2026-09-16. Base commit: `7d69e7c` (plus uncommitted working-tree
> changes listed in §10).

---

## 1. Stack and versions

| Concern | Value |
|---|---|
| Framework | Next.js **13.5.1**, App Router (no `pages/` directory) |
| Runtime | React 18.2, TypeScript 5.2.2, Node 22 (dev machine) |
| Styling | Tailwind 3.3 + `tailwindcss-animate`, shadcn/ui component library |
| Data | `@supabase/supabase-js` ^2.58 |
| Payments | **`stripe` ^14.21.0 already a dependency** — installed version 14.25.0 |
| Forms/validation | `react-hook-form` ^7.53 + `zod` ^3.23 + `@hookform/resolvers` |
| Icons | `lucide-react` ^0.446 |
| Charts | `recharts` ^2.12 |
| Test tooling | `vitest` ^1.3, `jsdom` ^24, `@testing-library/react` ^14, `@testing-library/jest-dom`, `@vitest/coverage-v8` — **all installed, none configured** |
| Hosting | Netlify via `@netlify/plugin-nextjs` ^5.15; CI also runs `next build` |

**Key consequence:** the Stripe SDK is already present, so Phase 2 needs **no dependency
install**. `package.json`/lockfile changes are limited to the test-runner config and, if
adopted, `server-only`.

---

## 2. Route structure

App Router, all routes under `app/`:

```text
app/
  page.tsx                          # landing
  layout.tsx                        # AuthProvider wrapper (see §3)
  globals.css                       # design tokens (see §7)
  [slug]/page.tsx                   # public profile page
  login/ · signup/ · profile/
  explore/page.tsx                  # marketplace browse
  days/[slug]/page.tsx              # ⚠ day detail — currently fixed-price sponsorship
  checkout/[slot]/page.tsx          # ⚠ fake checkout (see §5)
  checkout/success/page.tsx         # ⚠ success page used as payment confirmation
  reviews/[id]/page.tsx
  dashboard/brand/page.tsx
  dashboard/brand/campaigns/[id]/page.tsx
  dashboard/creator/page.tsx
  dashboard/creator/days/new/page.tsx
  dashboard/admin/page.tsx          # 1212 lines, largest file in the repo
  api/dashboard/brand/campaigns/route.ts
  api/dashboard/creator/data/route.ts
  api/dashboard/creator/days/route.ts
  api/dashboard/admin/stats/route.ts
  api/dashboard/admin/users/route.ts
```

There is **no** `app/api/stripe/**` yet, **no** webhook route, and **no** cron/job route.

### 2.1 Route handler conventions (must be followed)

Every existing API route follows the same pattern:

```ts
import { NextResponse } from 'next/server';
import { createAuthenticatedSupabaseClient } from '@/lib/supabase';

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const token = authHeader.replace('Bearer ', '');
  const supabase = createAuthenticatedSupabaseClient(token);
  // ...
}
```

So: **Authorization header → `createAuthenticatedSupabaseClient(token)`**. Admin routes
additionally call `supabase.auth.getUser()` and check `profile.role === 'admin'` (see
`app/api/dashboard/admin/users/route.ts:6-29`). New routes replicate this exactly.

---

## 3. Authentication helpers

- `lib/auth-context.tsx` — client-only `AuthProvider` / `useAuth()`. Reads the Supabase
  session, loads `profiles` by `user_id`, and also supports a **local dev admin bypass**
  (`lib/local-admin.ts`) driven by `NEXT_PUBLIC_TEST_ADMIN_EMAIL` /
  `NEXT_PUBLIC_TEST_ADMIN_PASSWORD` and a `localStorage` flag.
- `lib/supabase.ts` — exports the browser `supabase` client plus
  `createAuthenticatedSupabaseClient(token)` (server, RLS-scoped, per-request token),
  `isSupabaseConfigured`, and a graceful **unavailable-client Proxy** so the app renders
  when env vars are missing instead of throwing.
- **There is no service-role server client yet.** `.env` already defines
  `SUPABASE_SERVICE_ROLE_KEY`, but nothing reads it. Trusted writes (saving
  `stripe_account_id`, recording webhook state) require one — added in Phase 2.
- Note the local-admin bypass means the server cannot trust `useAuth()` alone; every
  financial route must verify the real Supabase session via the Authorization header.

---

## 4. Supabase server/client helpers

`lib/supabase.ts` hand-writes the entity types (`Profile`, `CreatorProfile`, `Day`,
`Slot`, `Sponsorship`, `Review`, `Deliverable`). There are **no generated database
types** in the repo. Per the brief, Engineer B will therefore maintain a **temporary**
application interface (`lib/auction-types.ts`) based on
`docs/auction-implementation-contract.md` and remove it once Engineer A's generated types
land.

Current money model is already minor-unit integer (`price integer`, `amount integer`,
`platform_fee integer`, `creator_amount integer`), which the auction contract extends.

---

## 5. Existing checkout page — the behaviour being replaced

`app/checkout/[slot]/page.tsx` (216 lines) is the "fake behaviour" the brief calls out:

- Loads a slot client-side with `supabase`.
- `handleCheckout()` (line 52) computes `platformFee = Math.round(slot.price * 0.1)` in
  the browser, **inserts a sponsorship directly from the client**, flips
  `sponsorship_slots.is_available = false`, toasts *"Your sponsorship of €X has been
  recorded. Payment via Stripe will be connected when configured."*, and pushes to
  `/checkout/success?id=<sponsorship-id>`.
- No Stripe call happens anywhere. The success page
  (`app/checkout/success/page.tsx`) then tells the user the creator "has been notified",
  which is not true.
- The page renders a dashed "Stripe payment integration — will be activated once Stripe
  is configured" placeholder where the payment element belongs.

`app/days/[slug]/page.tsx` is the matching fixed-price flow: `handleSponsor()` (line 57)
gates on auth + `role === 'brand'` + `is_available` + not-own-day, then routes to
`/checkout/[slot]`. Its right rail lists slots as fixed prices with "Available /
Already sponsored" — this becomes the auction panel.

**This is the code to delete/replace in Phase 9.**

---

## 6. Creator Stripe fields

`creator_profiles` already carries the Connect columns the brief needs:

```sql
stripe_account_id          text
stripe_onboarding_complete boolean DEFAULT false
```

Types mirrored in `lib/supabase.ts` (`CreatorProfile`, lines 88-103). Phase 3 writes
`stripe_account_id` via the service role and updates `stripe_onboarding_complete` from
`account.updated` webhooks. No schema change required for the account id itself.

---

## 7. Design system & Tailwind tokens

`design.md` is the authoritative style guide. Extracted rules that constrain new UI:

- **One accent colour**: green-teal `158 64% 42%` (`--accent`). Used for links,
  highlights, success states, CTAs. **Never introduce a second saturated colour.**
- Everything else is neutral greyscale (`--background` … `--muted-foreground`).
  `--destructive` `84 60%` is the only other non-neutral, reserved for
  errors/refunds/cancellations.
- **Use Tailwind tokens, never raw HSL** in components — i.e. `bg-accent`, not
  `bg-[hsl(158,64%,42%)]`.
- Type: `Inter` for body, `Instrument Serif` italic sparingly for emphasis.
- Motion: subtle fade/scale only, never bouncy.
- Radius `--radius: 0.75rem`; buttons in the existing app are overwhelmingly
  `rounded-full`.
- Dark mode via `class` strategy — every new component must work in both, since both
  token sets are defined in `globals.css`.
- shadcn/ui primitives are the component vocabulary: `Button`, `Badge`, `Card`,
  `Input`, `Dialog`, `Tabs`, `Table`, `Tooltip`, `Skeleton`, `Progress`, `DropdownMenu`.
  Existing dashboards use a shared inline `statusConfig` map (status → label + colour)
  that the auction statuses must extend rather than replace.

---

## 8. Dashboards

- **Brand** (`app/dashboard/brand/page.tsx`, 314 lines): fetches `sponsorships` joined to
  days/creator via the **browser client**, `filter: 'all' | 'active' | 'completed'`, stat
  cards, and an inline `statusConfig` map. `Campaign` type = `Sponsorship & { days; profiles }`.
- **Creator** (`app/dashboard/creator/page.tsx`, 396 lines): uses the
  `/api/dashboard/creator/data?profileId=` server route (the correct pattern), tabs
  `days | sponsorships`, computes `totalEarnings` and an `availableAmount` that currently
  sums **only `status === 'completed'`** rows — the brief's "do not show unpaid amounts
  as available earnings" rule means this must become `paid`-and-not-refunded with
  `payout_status` filtering.
- **Admin** (`app/dashboard/admin/page.tsx`, 1212 lines): client-side, pagination, search,
  search, a detail `Dialog`, inline toasts, and per-row `DropdownMenu` actions. Talks to
  the browser client directly for sponsorships.
- **Admin API** (`stats`, `users`) already establishes the **role-check pattern**
  (`auth.getUser()` → `profiles.role === 'admin'` → 403 otherwise) that admin financial
  actions must reuse.

---

## 9. Existing status components

There is **no reusable `StatusBadge` component**. Each dashboard defines its own inline
`statusConfig: Record<string, { label: string; color: string; icon?: … }>` mapping from
sponsorship status to a Tailwind colour class:

```ts
pending:           'bg-amber-500/10 text-amber-600'
paid:              'bg-blue-500/10 text-blue-600'
day_completed:     'bg-accent/10 text-accent'
cancelled/refunded:'bg-destructive/10 text-destructive'
```

The auction work adds a **shared** `components/auction/status-badge.tsx` (and a shared
status config) so the three dashboards stop duplicating the map, and the new auction /
bid / payout / refund statuses join it.

---

## 10. Notification mechanism

**Ephemeral only.** The repo has:

- `hooks/use-toast.ts` + `components/ui/toast.tsx` + `components/ui/toaster.tsx`
  (shadcn radix-toast implementation, `TOAST_LIMIT: 1`)
- `components/ui/sonner.tsx` (sonner wrapper, theme-aware)
- `app/dashboard/admin/page.tsx` also defines its own inline toast state
  (`type Toast = { id; message; type }`)

There is **no persistent notification store, no notifications table, no in-app bell, no
email.** Phase 13 therefore needs the `notifications` table (contract §3.5), a server
`createNotification()` helper that is **fire-and-forget after commit**, and toast as the
delivery surface. The admin page's inline toast duplication is not worth touching.

---

## 11. Scheduled jobs / cron

**None.** No `CRON_SECRET` usage, no cron route, no queue, no background worker, no
`vercel.json`, and Netlify has no scheduled-function trigger configured
(`netlify.toml` is build config only). The `package.json` scripts are
`dev | build | start | lint | typecheck | test | test:watch | db:push | seed`.

Phase 8 therefore has to **add** the job system, not integrate into an existing one:
HTTP routes under `app/api/cron/**` guarded by a constant-time `CRON_SECRET` comparison,
invoking Engineer A's RPCs. `AUCTION_MAX_WINNER_ATTEMPTS` and
`AUCTION_PAYMENT_DEADLINE_HOURS` are read server-side from env; **cron request parameters
are never trusted for user ids or amounts** (see contract §4.2 — batch size only).

---

## 12. Tests

**None exist.** Vitest, jsdom, `@testing-library/react`, `@testing-library/jest-dom` and
`coverage-v8` are all declared in `package.json` but there is **no `vitest.config.ts`,
no setup file, no test file, and no `test` script result has ever run**. `.gitignore`
already excludes `/coverage`.

Phase 15 must first stand up the runner (config + jsdom environment + jest-dom setup)
before any test can execute.

---

## 13. Baseline quality gates

Measured before any change:

```text
npm run typecheck  → FAILS (pre-existing, 2 errors in lib/data.ts)
npm run lint       → not yet run in this session
npm run build      → not yet run in this session (eslint.ignoreDuringBuilds: true)
```

Pre-existing `tsc --noEmit` errors (do **not** treat these as regressions; they are in
`lib/data.ts`, outside Engineer B's change surface):

```text
lib/data.ts(109,91): error TS2339: Property 'amount' does not exist on type 'SponsorshipStatsRow'.
lib/data.ts(156,31): error TS2352: Conversion of type … to type 'ActivitySponsorship[]' may be a mistake
```

Cause: `SponsorshipStatsRow` selects only `id, slot_id, brand_id, creator_amount,
status`, but `loadMarketplaceStats` reduces over `sponsorship.amount`; and
`loadLiveActivity` selects `brand`/`creator` as arrays (one-to-many join shape) while
typing them as objects. Both are trivial to fix but belong to whoever owns `lib/data.ts`;
flagged in the handoff rather than silently changed.

---

## 14. Environment variables in use today

```text
.env      → NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
.env.local→ NEXT_PUBLIC_TEST_ADMIN_EMAIL, NEXT_PUBLIC_TEST_ADMIN_PASSWORD
.env.example → ⚠ committed/untracked, contains a real-looking Supabase anon JWT,
               placeholder Stripe keys, RESEND_API_KEY, AUTH_SECRET,
               and a REAL local-admin email + password (see §15)
```

`.gitignore` ignores `.env` and `.env*.local` but **not** `.env.example`. It is currently
untracked in the working tree, having been deleted from the repo in commit
`ab496fa`.

---

## 15. Findings that need attention before or alongside the build

1. **`.env.example` contains a real local-admin password** (`AZSXDCFV@123a`) and a real
   Supabase anon JWT rather than placeholders. Since `.env.example` is meant to be a safe
   template committed to the repo, Phase 14 replaces every value with an inert
   placeholder and adds `.env.example` back to git. The live values belong only in
   `.env`/`.env.local`.
2. **`SUPABASE_SERVICE_ROLE_KEY` is present but unused.** Phase 2 adds a single
   server-only service client; its usage must stay out of any client bundle, and it must
   never be exposed to the browser.
3. **`next.config.js` sets `eslint.ignoreDuringBuilds: true`** — the build will not fail
   on lint problems. `npm run lint` must be run explicitly in CI. Left as-is (it is a
   build-config decision, not Engineer B's), but the handoff notes that lint is a
   separate gate.
4. **`app/[slug]/page.tsx` vs `app/days/[slug]/page.tsx`** — two dynamic root segments
   at the same level. Not a conflict today (the profile page is the root catch-all), but
   new top-level dynamic routes must not collide.
5. **The browser success redirect is trusted as payment confirmation today.** That is the
   core defect Phase 5 removes; the success page becomes purely informational and
   re-reads payment state from the database.

---

## 16. What this means for the plan

- No dependency install needed for Stripe; test tooling needs a config but no new
  packages.
- The financial surface is greenfield: no webhook route, no service client, no cron, no
  Stripe routes. Everything in Phases 2–8 is new code following the §2.1 route convention
  and §3 auth helpers.
- The UI surface is brownfield: three dashboards and the day page must be *extended* in
  their existing idiom (shared `statusConfig`, shadcn primitives, Tailwind tokens, both
  light/dark), not rewritten.
- The single largest risk is that the auction schema does not exist yet. All DB access
  therefore funnels through a temporary typed layer (`lib/auction-types.ts` +
  `lib/auction-queries.ts`) so that when Engineer A's migration lands, only that layer
  changes.
