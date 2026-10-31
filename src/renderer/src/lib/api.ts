import type { AppError, Result } from '@shared/result'

/** Typed access to the main process. */
export const api = window.api

export class ApiError extends Error {
  readonly code: AppError['code']

  constructor(error: AppError) {
    super(error.message)
    this.name = 'ApiError'
    this.code = error.code
  }
}

/** Returns the data of a successful Result, or throws an ApiError. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new ApiError(result.error)
  return result.data
}
