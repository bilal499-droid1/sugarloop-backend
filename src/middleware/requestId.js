import { randomUUID } from 'node:crypto'

/**
 * Tags every request with an id, echoed in the response header and included in both
 * logs and error bodies.
 *
 * This is what turns "a customer says their order failed at around 9pm" into a single
 * grep. Without it, correlating a user report to a log line on a busy night is guesswork.
 */
export function requestId(req, res, next) {
  req.id = req.get('x-request-id') || randomUUID()
  res.set('x-request-id', req.id)
  next()
}
