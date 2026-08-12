import mongoose from 'mongoose'
import { ZodError } from 'zod'
import { ApiError } from '../utils/ApiError.js'
import { logger } from '../config/logger.js'
import { env } from '../config/env.js'

/** 404 for anything no router matched. Mounted after all routes. */
export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`))
}

/**
 * The single place an error becomes a response.
 *
 * Rule: only errors we raised deliberately (ApiError) or recognise (Zod, Mongoose)
 * get their message shown to the client. Everything else is a bug and becomes a
 * generic 500 — unexpected error text leaks paths, driver internals and sometimes
 * connection strings.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
export function errorHandler(err, req, res, next) {
  const normalised = normalise(err)

  const logPayload = {
    err,
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    statusCode: normalised.statusCode,
  }

  // 5xx is our fault and needs a stack. 4xx is the caller's and would drown the logs.
  if (normalised.statusCode >= 500) {
    logger.error(logPayload, normalised.message)
  } else {
    logger.warn(logPayload, normalised.message)
  }

  const body = {
    error: {
      code: normalised.code,
      message: normalised.message,
    },
  }

  if (normalised.details) body.error.details = normalised.details
  if (req.id) body.error.requestId = req.id
  // Stacks are a development aid and an information leak in production.
  if (!env.isProduction && normalised.statusCode >= 500) body.error.stack = err.stack

  res.status(normalised.statusCode).json(body)
}

function normalise(err) {
  if (err instanceof ApiError) return err

  // Body/query failed schema validation — the caller genuinely needs the field list.
  if (err instanceof ZodError) {
    return ApiError.validation('Request validation failed', formatZodIssues(err))
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return ApiError.validation(
      'Data validation failed',
      Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }))
    )
  }

  // A malformed ObjectId in the URL is a bad request, not a server fault.
  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for '${err.path}'`)
  }

  // Duplicate key on a unique index — e.g. two branches sharing a code.
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {}).join(', ') || 'field'
    return ApiError.conflict(`A record with this ${field} already exists`)
  }

  if (err?.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON')
  }

  if (err?.type === 'entity.too.large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large')
  }

  return ApiError.internal()
}

function formatZodIssues(err) {
  return err.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }))
}
