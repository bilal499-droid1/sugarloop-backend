/**
 * Express 4 does not catch rejected promises from async handlers — the rejection
 * becomes an unhandled rejection and the request hangs until the client times out.
 * Wrapping every async route in this forwards the rejection to the error middleware.
 *
 * Usage:  router.get('/', asyncHandler(controller.list))
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next)
