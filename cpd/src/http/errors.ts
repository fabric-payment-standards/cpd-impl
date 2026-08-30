import type { Request, Response, NextFunction } from "express";
import { CpdValidationError } from "../cpd/validation.js";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Unknown route." },
  } satisfies ApiErrorBody);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof CpdValidationError) {
    const fields: Record<string, string> = {};
    for (const e of err.errors) fields[e.field] = e.rule;
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "Payment failed validation.", fields },
    } satisfies ApiErrorBody);
    return;
  }

  if (err instanceof SyntaxError) {
    res.status(400).json({
      error: { code: "MALFORMED_REQUEST", message: err.message || "Request body is not valid JSON." },
    } satisfies ApiErrorBody);
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message },
    } satisfies ApiErrorBody);
    return;
  }

  // Never leak internals — log server-side only.
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
  } satisfies ApiErrorBody);
}
