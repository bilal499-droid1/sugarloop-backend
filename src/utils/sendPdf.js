/**
 * The one place a PDF leaves the API.
 *
 * `Content-Disposition: attachment` rather than `inline` deliberately: these are documents
 * somebody keeps — an invoice for a dispute, a report for a month-end — and a browser tab
 * that renders one and is then navigated away from has saved nothing.
 *
 * `filename` is quoted and stripped of anything that could break out of the header. It is
 * built from an order number or a date today, but a header assembled from a value that
 * merely happens to be safe is one refactor away from being an injection.
 */
export function sendPdf(res, buffer, filename) {
  const safe = String(filename).replace(/[^\w.-]/g, '_')

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`)
  res.setHeader('Content-Length', buffer.length)

  return res.send(buffer)
}
