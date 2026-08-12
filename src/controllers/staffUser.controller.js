import { ok, created, paginated } from '../views/respond.js'
import { staffUserView, staffUserListView } from '../views/staffUserView.js'
import * as staffUserService from '../services/staffUser.service.js'

/**
 * Thin by design (plan §2): read the request, call a service, shape the response.
 * No Mongoose, no business rules — those live in services/staffUser.service.js so they
 * are testable without an HTTP layer and cannot drift between two call sites.
 */

function contextOf(req) {
  return { actor: req.staff, ip: req.ip ?? '' }
}

export async function list(req, res) {
  const { limit } = req.validatedQuery
  const { items, nextCursor } = await staffUserService.list(req.validatedQuery)
  return paginated(res, staffUserListView(items), { limit, nextCursor })
}

export async function getOne(req, res) {
  const staffUser = await staffUserService.getById(req.params.id)
  return ok(res, { staffUser: staffUserView(staffUser) })
}

export async function create(req, res) {
  const staffUser = await staffUserService.create(req.body, contextOf(req))
  return created(res, { staffUser: staffUserView(staffUser) })
}

export async function update(req, res) {
  const staffUser = await staffUserService.update(req.params.id, req.body, contextOf(req))
  return ok(res, { staffUser: staffUserView(staffUser) })
}

export async function resetPassword(req, res) {
  const staffUser = await staffUserService.resetPassword(
    req.params.id,
    req.body.password,
    contextOf(req)
  )
  return ok(res, { staffUser: staffUserView(staffUser) })
}

export async function deactivate(req, res) {
  const staffUser = await staffUserService.deactivate(req.params.id, contextOf(req))
  return ok(res, { staffUser: staffUserView(staffUser) })
}
