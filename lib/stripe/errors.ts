import type Stripe from 'stripe';

/**
 * Centralized Stripe error normalization.
 *
 * Every Stripe failure that reaches a route handler flows through `normalizeStripeError`
 * so that:
 *  - the HTTP status code is derived from the Stripe error type, not guessed;
 *  - the client receives a safe, generic message that never contains a secret value,
 *    card number, client secret, or raw payload;
 *  - the server logs only the safe diagnostic fields (request id / type / code).
 *
 * Never log `raw.error` payloads wholesale, `client_secret`, `card.number`, or a raw
 * webhook body. This module is the only place that decides what is safe to surface.
 */

/** Safe, generic error codes the client can branch on. */
export type StripeErrorCode =
  | 'not_configured'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'rate_limited'
  | 'stripe_unavailable'
  | 'already_processed'
  | 'conflict'
  | 'internal_error';

/** A normalized error that is safe to serialize into an API response. */
export class StripeOperationError extends Error {
  readonly statusCode: number;
  readonly code: StripeErrorCode;
  /** Stripe's request identifier. Safe to surface (it is not a secret). */
  readonly stripeRequestId: string | null;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: StripeErrorCode;
      cause?: unknown;
      stripeRequestId?: string | null;
    } = {},
  ) {
    super(message);
    this.name = 'StripeOperationError';
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'internal_error';
    this.stripeRequestId = options.stripeRequestId ?? null;
    if (options.cause !== undefined) {
      // Avoid the raw cause being serialized into a response by accident.
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false });
    }
  }

  /** A JSON-safe representation for API responses. Contains no secrets. */
  toJson() {
    return {
      error: this.message,
      code: this.code,
      stripe_request_id: this.stripeRequestId,
    } as const;
  }
}

/** True when a thrown value is a Stripe SDK error. */
function isStripeError(error: unknown): error is Stripe.errors.StripeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof (error as { type: unknown }).type === 'string'
  );
}

/**
 * Maps a Stripe error type to an HTTP status code and a safe generic code.
 *
 * Follows Stripe's documented error taxonomy:
 * https://stripe.com/docs/api/errors
 */
export function classifyStripeError(error: unknown): {
  statusCode: number;
  code: StripeErrorCode;
  message: string;
  stripeRequestId: string | null;
} {
  // Errors thrown by our own layer.
  if (error instanceof StripeOperationError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      stripeRequestId: error.stripeRequestId,
    };
  }

  if (isStripeError(error)) {
    const stripeError = error as Stripe.errors.StripeError & {
      code?: string;
      message?: string;
      requestId?: string;
    };
    const requestId = stripeError.requestId ?? null;
    const stripeMessage = stripeError.message ?? 'Stripe request failed';

    switch (stripeError.type) {
      case 'StripeCardError':
        // Declined card. The decline code is safe to show; the PAN never is.
        return {
          statusCode: 402,
          code: 'invalid_request',
          message: stripeMessage,
          stripeRequestId: requestId,
        };
      case 'StripeInvalidRequestError':
        return {
          statusCode: 400,
          code: 'invalid_request',
          message: stripeMessage,
          stripeRequestId: requestId,
        };
      case 'StripeAuthenticationError':
        return {
          statusCode: 401,
          code: 'unauthenticated',
          message: 'Stripe authentication failed. Check the server configuration.',
          stripeRequestId: requestId,
        };
      case 'StripeRateLimitError':
        return {
          statusCode: 429,
          code: 'rate_limited',
          message: 'Too many requests to Stripe. Please retry shortly.',
          stripeRequestId: requestId,
        };
      case 'StripePermissionError':
        return {
          statusCode: 403,
          code: 'forbidden',
          message: 'The Stripe account is not permitted to perform this action.',
          stripeRequestId: requestId,
        };
      case 'StripeConnectionError':
        return {
          statusCode: 503,
          code: 'stripe_unavailable',
          message: 'Could not reach Stripe. Please retry.',
          stripeRequestId: requestId,
        };
      case 'StripeIdempotencyError':
        return {
          statusCode: 409,
          code: 'already_processed',
          message: 'This operation was already processed with different parameters.',
          stripeRequestId: requestId,
        };
      default:
        return {
          statusCode: 502,
          code: 'internal_error',
          message: 'Stripe returned an unexpected error.',
          stripeRequestId: requestId,
        };
    }
  }

  // Non-Stripe errors: never leak internals.
  return {
    statusCode: 500,
    code: 'internal_error',
    message: 'An unexpected error occurred while contacting the payment provider.',
    stripeRequestId: null,
  };
}

/**
 * Wraps an async Stripe operation, normalizing any failure into a
 * `StripeOperationError` and logging only safe diagnostic fields.
 */
export async function withStripeError<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const classification = classifyStripeError(error);

    // Log only safe fields. `operation` is our own label; never the payload.
    console.error('[stripe] operation failed', {
      operation,
      code: classification.code,
      status: classification.statusCode,
      stripe_request_id: classification.stripeRequestId,
    });

    throw new StripeOperationError(classification.message, {
      statusCode: classification.statusCode,
      code: classification.code,
      cause: error,
      stripeRequestId: classification.stripeRequestId,
    });
  }
}

/**
 * True when a normalized error is transient and safe for the webhook handler to signal
 * as "retry me" (Stripe will redeliver).
 */
export function isRetryable(error: StripeOperationError) {
  return (
    error.statusCode === 429 ||
    error.statusCode === 503 ||
    error.code === 'rate_limited' ||
    error.code === 'stripe_unavailable'
  );
}