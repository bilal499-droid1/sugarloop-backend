import { created } from '../views/respond.js'
import { branchView } from '../views/branchView.js'
import * as staffBranchService from '../services/staffBranch.service.js'

/** Thin by design: read the request, call the service, shape the response. */

export async function create(req, res) {
  const branch = await staffBranchService.create(req.body, {
    actor: req.staff,
    ip: req.ip ?? '',
  })

  return created(res, { branch: branchView(branch) })
}
