import { created } from '../views/respond.js'
import { enquiryReceiptView } from '../views/enquiryView.js'
import * as enquiryService from '../services/enquiry.service.js'

/** Thin by design: read the request, call the service, shape the response. */

export async function create(req, res) {
  const enquiry = await enquiryService.create(req.body, {
    ip: req.ip ?? '',
    userAgent: req.get('user-agent') ?? '',
  })

  return created(res, { enquiry: enquiryReceiptView(enquiry) })
}
