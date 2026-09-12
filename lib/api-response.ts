import { NextResponse } from 'next/server';

export type ApiSuccess<T = unknown> = {
  success: true;
  data: T;
};

export type ApiError = {
  success: false;
  error: string;
  details?: unknown;
};

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

export function created<T>(data: T): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, { status: 201 });
}

export function badRequest(error: string, details?: unknown): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error, details }, { status: 400 });
}

export function unauthorized(error = 'Unauthorized'): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error }, { status: 401 });
}

export function forbidden(error = 'Forbidden'): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error }, { status: 403 });
}

export function notFound(error = 'Not found'): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error }, { status: 404 });
}

export function conflict(error: string): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error }, { status: 409 });
}

export function serverError(error = 'Internal server error', details?: unknown): NextResponse<ApiError> {
  console.error('[API Error]', error, details);
  return NextResponse.json({ success: false, error }, { status: 500 });
}
