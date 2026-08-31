import { ok, created } from '../views/respond.js'
import { staffBranchView, staffBranchListView } from '../views/branchView.js'
import * as staffBranchService from '../services/staffBranch.service.js'

/** Thin by design: read the request, call the service, shape the response. */

function contextOf(req) {
  return { actor: req.staff, ip: req.ip ?? '' }
}

export async function list(req, res) {
  const branches = await staffBranchService.list()
  return ok(res, { branches: staffBranchListView(branches) })
}

export async function create(req, res) {
  const branch = await staffBranchService.create(req.body, contextOf(req))

  return created(res, { branch: staffBranchView(branch) })
}

export async function update(req, res) {
  const branch = await staffBranchService.update(req.params.id, req.body, contextOf(req))

  return ok(res, { branch: staffBranchView(branch) })
}
