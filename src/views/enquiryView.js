/**
 * What comes back after submitting the corporate form.
 *
 * Almost nothing, and that is the point. The customer already knows what they typed, so
 * echoing it back buys them nothing and hands anyone probing the endpoint a confirmation
 * of what it stores. A reference they can quote on the phone, and the fact it was
 * received, is the whole useful payload.
 *
 * `emailedAt` is NOT here either: whether the shop's notification got out is an
 * operational detail, and a customer told "we saved it but could not email ourselves"
 * learns only that something is broken.
 */
export function enquiryReceiptView(enquiry) {
  return {
    id: String(enquiry._id),
    reference: String(enquiry._id).slice(-8).toUpperCase(),
    receivedAt: enquiry.createdAt,
  }
}

/**
 * The same lead as an admin sees it — everything the customer typed, plus what has been
 * done about it.
 *
 * Two fields are here that the receipt above deliberately withholds:
 *
 *   `emailed`   whether the notification actually left. A false here is a lead nobody
 *               has been told about, which is the single most useful thing this screen
 *               can surface — and meaningless to the customer, who would only learn
 *               that something is broken.
 *   `notes`     the handover trail.
 *
 * `meta` is NOT here. The submitter's IP and user agent exist for investigating a
 * scripted form, not for reading over morning coffee, and nothing on this screen acts
 * on them.
 */
export function staffEnquiryView(enquiry) {
  return {
    id: String(enquiry._id),
    reference: String(enquiry._id).slice(-8).toUpperCase(),
    name: enquiry.name,
    phone: enquiry.phone,
    email: enquiry.email,
    company: enquiry.company,
    subject: enquiry.subject,
    message: enquiry.message,
    status: enquiry.status,
    emailed: Boolean(enquiry.emailedAt),
    emailedAt: enquiry.emailedAt,
    notes: (enquiry.notes ?? []).map((note) => ({
      by: String(note.by),
      byName: note.byName,
      text: note.text,
      at: note.at,
    })),
    receivedAt: enquiry.createdAt,
  }
}

export function staffEnquiryListView(enquiries) {
  return enquiries.map(staffEnquiryView)
}
