import mongoose from 'mongoose'
import { ENQUIRY_KIND, ENQUIRY_STATUS } from '../config/constants.js'

/**
 * Something a member of the public asked us (BACKEND-DESIGN §3, `enquiries`).
 *
 * Two kinds share this collection: a corporate gifting lead and a question from the FAQ
 * page. See `kind` below for why they are one collection and not two.
 *
 * **Stored first, emailed second.** The email is how anyone finds out about a lead, but
 * it is not where the lead lives: SMTP fails, inboxes filter, and a company asking about
 * a 200-box order is not something to lose to a spam folder. The row is the record and
 * `emailedAt` says whether the notification actually got out — a null there is a lead
 * nobody has been told about, which is a question worth being able to ask.
 */
const enquirySchema = new mongoose.Schema(
  {
    /**
     * Which public form this came from. See ENQUIRY_KIND.
     *
     * Defaulted to `corporate` rather than left required, because every row written
     * before the FAQ form existed is a corporate lead — so the default backfills the
     * existing collection correctly and no migration is needed.
     */
    kind: {
      type: String,
      enum: Object.values(ENQUIRY_KIND),
      default: ENQUIRY_KIND.CORPORATE,
      index: true,
    },

    name: { type: String, required: true, trim: true, maxlength: 120 },

    /**
     * Deliberately looser than the customer phone rules elsewhere in this API, which
     * demand a Pakistani mobile. A company's contact number is as likely to be a
     * landline (`+92 51 …`) or a UAN, and refusing a real corporate lead over the shape
     * of its switchboard number would be the wrong trade entirely.
     *
     * Required for a corporate lead — somebody is going to ring them about a quote — and
     * optional for a question, where the answer goes back by email and demanding a phone
     * number to ask whether the donuts contain nuts would lose more questions than it
     * helps anyone answer.
     */
    phone: {
      type: String,
      required() {
        return this.kind === ENQUIRY_KIND.CORPORATE
      },
      trim: true,
      maxlength: 32,
      default: '',
    },

    /** The reply channel, so it is the one field that has to be genuinely valid. */
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Must be a valid email address'],
    },

    company: { type: String, trim: true, maxlength: 160, default: '' },
    subject: { type: String, trim: true, maxlength: 200, default: '' },
    message: { type: String, trim: true, maxlength: 2000, default: '' },

    status: {
      type: String,
      enum: Object.values(ENQUIRY_STATUS),
      default: ENQUIRY_STATUS.NEW,
      index: true,
    },

    /** Set when the notification email actually left. Null means it did not. */
    emailedAt: { type: Date, default: null },

    /**
     * What has been done about this lead, appended never edited.
     *
     * The point is the handover: whoever picks up a half-worked enquiry needs to know it
     * was called on Tuesday and they wanted a quote, rather than starting the
     * conversation cold or ringing a company that has already said no. Each entry keeps
     * the staff id AND their name at the time of writing — an author who is later
     * deactivated or renamed must not turn a year of notes into unattributed text.
     */
    notes: [
      {
        _id: false,
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffUser', required: true },
        byName: { type: String, required: true },
        text: { type: String, required: true, trim: true, maxlength: 2000 },
        at: { type: Date, default: Date.now },
      },
    ],

    /** For abuse investigation if the form gets scripted. Never shown to anyone. */
    meta: {
      ip: { type: String, default: '' },
      userAgent: { type: String, default: '' },
    },
  },
  {
    collection: 'enquiries',
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

// The only way anyone reads this collection is "newest first", optionally narrowed to
// the ones nobody has dealt with yet.
enquirySchema.index({ createdAt: -1 })
enquirySchema.index({ status: 1, createdAt: -1 })
// The inbox is worked one kind at a time — sales leads and customer questions are
// different jobs — so the kind almost always narrows the status query rather than
// standing on its own.
enquirySchema.index({ kind: 1, status: 1, createdAt: -1 })

export const Enquiry = mongoose.model('Enquiry', enquirySchema)
