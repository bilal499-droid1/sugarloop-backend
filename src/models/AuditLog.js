import mongoose from 'mongoose'

/**
 * Every staff action, append-only.
 *
 * With three roles and cash changing hands, this is the record you want the first time
 * something goes missing: who marked what out of stock, who moved an order to `failed`
 * and why, who reset whose password. `updatedBy` on a document tells you the last
 * writer; it cannot tell you what the value was before, or who changed it twice.
 */
const auditLogSchema = new mongoose.Schema(
  {
    /** Null only for actions the system took on its own (status timers). */
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffUser', default: null },
    actorEmail: { type: String, default: '' },
    actorRole: { type: String, default: '' },

    /** Dotted verb — 'staffUser.create', 'order.status.change', 'stock.toggle'. */
    action: { type: String, required: true, trim: true },

    /** What was acted on. Stored loosely so this collection never needs a migration. */
    entity: { type: String, required: true, trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },

    /**
     * Before/after for the fields that changed. Whatever is written here is readable by
     * anyone with database access, so callers must never put a password, a token or a
     * customer's full address in it.
     */
    changes: { type: mongoose.Schema.Types.Mixed, default: null },

    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

// The two questions actually asked of an audit trail: "what happened to this record?"
// and "what did this person do?".
auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 })
auditLogSchema.index({ actorId: 1, createdAt: -1 })

export const AuditLog = mongoose.model('AuditLog', auditLogSchema)
