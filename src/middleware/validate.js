import { ZodError } from 'zod'
import { ApiError } from '../utils/ApiError.js'

/**
 * Validates request parts against Zod schemas and REPLACES them with the parsed
 * result, so controllers receive coerced, stripped, typed data.
 *
 * The replacement is the point. If a controller reads `req.body` directly it is
 * reading whatever the caller sent — including extra fields, string numbers, and
 * `price: 1` on a cart the server is supposed to be pricing itself.
 *
 *   router.post('/orders', validate({ body: createOrderSchema }), handler)
 */
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params)
      if (schemas.query) req.validatedQuery = schemas.query.parse(req.query)
      if (schemas.body) req.body = schemas.body.parse(req.body)
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        next(
          ApiError.validation(
            'Request validation failed',
            err.issues.map((issue) => ({
              field: issue.path.join('.') || '(root)',
              message: issue.message,
            }))
          )
        )
        return
      }
      next(err)
    }
  }
}
