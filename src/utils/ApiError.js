/**
 * An error we chose to raise, as opposed to one that escaped.
 *
 * The distinction matters in the error handler: an ApiError carries a status and a
 * client-safe message, so it is returned as-is. Anything else is a bug, gets logged
 * at error level with a stack, and is flattened to a generic 500 — because the text
 * of an unexpected error routinely leaks table names, file paths and connection
 * strings.
 */
export class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
    this.isOperational = true
    Error.captureStackTrace?.(this, ApiError)
  }

  static badRequest(message, details) {
    return new ApiError(400, 'BAD_REQUEST', message, details)
  }

  static validation(message, details) {
    return new ApiError(422, 'VALIDATION_ERROR', message, details)
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message)
  }

  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(403, 'FORBIDDEN', message)
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, 'NOT_FOUND', message)
  }

  /** Request was valid but the world changed — item sold out, branch closed, price moved. */
  static conflict(message, details) {
    return new ApiError(409, 'CONFLICT', message, details)
  }

  static tooManyRequests(message = 'Too many requests, please try again shortly') {
    return new ApiError(429, 'TOO_MANY_REQUESTS', message)
  }

  static internal(message = 'Something went wrong') {
    return new ApiError(500, 'INTERNAL_ERROR', message)
  }
}
