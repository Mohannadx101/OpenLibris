/**
 * Errors cross the IPC boundary as plain data, never as thrown exceptions, so the
 * renderer can always decide how to present them.
 */
export type ErrorCode =
  /** The request payload did not match its schema. */
  | 'VALIDATION'
  /** The request came from somewhere other than the app's own window. */
  | 'FORBIDDEN'
  /** The requested record or file does not exist. */
  | 'NOT_FOUND'
  /** Anything unexpected. Details are logged in the main process. */
  | 'INTERNAL'

export interface AppError {
  code: ErrorCode
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function err(code: ErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } }
}

/** Thrown inside main-process handlers to produce a specific error code. */
export class AppFailure extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'AppFailure'
    this.code = code
  }
}
