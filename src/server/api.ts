import { NextResponse } from "next/server";

type ErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
};

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data, error: null }, init);
}

export function fail(code: string, message: string, status = 400, details?: unknown) {
  const error: ErrorPayload = { code, message };
  if (details !== undefined) {
    error.details = details;
  }

  return NextResponse.json({ data: null, error }, { status });
}
