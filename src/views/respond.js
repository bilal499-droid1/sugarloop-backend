/**
 * The response envelope, in one place.
 *
 * Success:  { "data": ... }                       (+ "meta" on paginated lists)
 * Failure:  { "error": { code, message, ... } }   (built in errorHandler.js)
 *
 * Every endpoint goes through these helpers so the frontend can write one client
 * that unwraps `data` and one error path that reads `error.code` — instead of
 * remembering which endpoints return bare arrays.
 */

export function ok(res, data, meta) {
  const body = { data }
  if (meta) body.meta = meta
  return res.status(200).json(body)
}

export function created(res, data) {
  return res.status(201).json({ data })
}

export function noContent(res) {
  return res.status(204).end()
}

/**
 * Cursor pagination, not offset. Offset pagination skips and duplicates rows when the
 * underlying list changes between pages — which it constantly does on an order board.
 */
export function paginated(res, items, { nextCursor = null, limit } = {}) {
  return res.status(200).json({
    data: items,
    meta: { count: items.length, limit, nextCursor, hasMore: Boolean(nextCursor) },
  })
}
