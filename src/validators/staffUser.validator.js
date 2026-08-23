import { z } from 'zod'
import { STAFF_ROLE } from '../config/constants.js'
import { passwordSchema as password } from './password.js'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id')

const email = z.string().trim().toLowerCase().email('Must be a valid email address')

const role = z.enum(Object.values(STAFF_ROLE))

export const idParamSchema = z.object({ id: objectId })

export const createStaffUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  password,
  role,
  // Required for a branch manager, forbidden for an admin. Enforced in the service and
  // again by the StaffUser model, so neither layer is the only guard.
  branchId: objectId.nullish(),
})

export const updateStaffUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email,
    role,
    branchId: objectId.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  // An empty PATCH is almost always a client bug — a serialiser that dropped every
  // field. Returning 422 surfaces it instead of reporting a successful no-op.
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update',
  })

export const resetPasswordSchema = z.object({ password })

export const listStaffUsersSchema = z.object({
  role: role.optional(),
  branchId: objectId.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: objectId.optional(),
})
