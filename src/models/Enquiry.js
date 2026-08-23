import mongoose from 'mongoose'
import { ENQUIRY_STATUS } from '../config/constants.js'

/**
 * A corporate gifting enquiry (BACKEND-DESIGN §3, `enquiries`).
 *
 * **Stored first, emailed second.** The email is how anyone finds out about a lead, but
 * it is not where the lead lives: SMTP fails, inboxes filter, and a company asking about
 * a 200-box order is not something to lose to a spam folder. The row is the record and
 * `emailedAt` says whether the notification actually got out — a null there is a lead
 * nobody has been told about, which is a question worth being able to ask.
 */
const enquirySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },

    /**
     * Deliberately looser than the customer phone rules elsewhere in this API, which
     * demand a Pakistani mobile. A company's contact number is as likely to be a
     * landline (`+92 51 …`) or a UAN, and refusing a real corporate lead over the shape
     * of its switchboard number would be the wrong trade entirely.
     */
    phone: { type: String, required: true, trim: true, maxlength: 32 },

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

export const Enquiry = mongoose.model('Enquiry', enquirySchema)
