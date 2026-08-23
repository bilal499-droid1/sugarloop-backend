import { ok, paginated } from '../views/respond.js'
import { staffEnquiryView, staffEnquiryListView } from '../views/enquiryView.js'
import * as staffEnquiryService from '../services/staffEnquiry.service.js'

/** Thin by design: read the request, call a service, shape the response. No Mongoose. */

function contextOf(req) {
  return { actor: req.staff, ip: req.ip ?? '' }
}

export async function list(req, res) {
  const { limit } = req.validatedQuery
  const { items, nextCursor } = await staffEnquiryService.list(req.validatedQuery)
  return paginated(res, staffEnquiryListView(items), { limit, nextCursor })
}

/** Counts for the filter chips. Its own endpoint so the list stays one cheap query. */
export async function summary(_req, res) {
  return ok(res, { summary: await staffEnquiryService.summary() })
}

export async function getOne(req, res) {
  const enquiry = await staffEnquiryService.getById(req.params.id)
  return ok(res, { enquiry: staffEnquiryView(enquiry) })
}

export async function update(req, res) {
  const enquiry = await staffEnquiryService.update(req.params.id, req.body, contextOf(req))
  return ok(res, { enquiry: staffEnquiryView(enquiry) })
}
