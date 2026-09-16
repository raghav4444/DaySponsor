/**
 * Guard for the protected scheduled-job routes.
 *
 * The scheduler is the only caller these routes accept, and it proves itself with a
 * shared secret sent as `Authorization: Bearer <CRON_SECRET>`. The comparison is
 * timing-safe: the secret authorizes financial transitions (closing auctions,
 * expiring winners, paying out creators), so a leaked-adjacent guess should not be
 * helped along by a timing side channel.
 *
 * What the secret does *not* do: parameterize the run. These routes never accept a
 * user id, a sponsorship id, or an amount from the request. The job discovers its
 * own work from the database; the request only says "run now".
 */

import { getPlatformConfig } from '@/lib/stripe/server';

/** Timing-safe comparison for two equal-length secrets. Returns false on length mismatch. */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Reads and validates the bearer token. Returns null when the request is not
 * authorized — callers respond 401 and never reveal which half was wrong.
 */
export function authorizeCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length === 0) {
    // No secret configured: the job cannot run safely. Fail closed.
    return false;
  }

  const header = request.headers.get('authorization');
  if (!header) return false;

  const [scheme, token] = header.split(' ', 2);
  if (scheme.toLowerCase() !== 'bearer' || !token) return false;

  return safeCompare(token.trim(), expected);
}

/** True when the deployment has a working service-role key, so jobs can run at all. */
export function cronSecretConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length > 0);
}

/** Standard JSON body for a cron route response. */
export type CronResult = {
  job: string;
  ran: boolean;
  /** Machine-readable outcome counts, for scheduler dashboards. */
  counts: Record<string, number>;
  /** Human-readable note for the log stream. Never contains user ids. */
  note?: string;
};

/**
 * Runs a job body with the guard applied and normalizes the outcome into a
 * `CronResult`. A job that throws is reported as `ran: false` with a 500, so the
 * scheduler sees the failure and retries — the failure never silently passes.
 */
export async function runCronJob(
  request: Request,
  job: string,
  body: () => Promise<CronResult>,
): Promise<Response> {
  if (!authorizeCronRequest(request)) {
    return Response.json(
      { error: 'Unauthorized. Provide a valid CRON_SECRET as a bearer token.' },
      { status: 401 },
    );
  }

  try {
    const result = await body();
    return Response.json(result, { status: 200 });
  } catch (thrown) {
    const code = (thrown as { code?: string })?.code;
    const status = (thrown as { statusCode?: number })?.statusCode;
    const message = (thrown as { message?: string })?.message;

    console.error('[cron] job failed', {
      job,
      code: code ?? 'unknown',
      status: status ?? 500,
      message: typeof message === 'string' ? message : String(thrown),
    });

    return Response.json(
      {
        job,
        ran: false,
        counts: {},
        error: 'The job failed. See server logs.',
      },
      { status: 500 },
    );
  }
}

/** Currency used by the reconciliation job's log lines. */
export function cronCurrency(): string {
  return getPlatformConfig().currency;
}
