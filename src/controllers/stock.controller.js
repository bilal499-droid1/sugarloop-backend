import { ok } from '../views/respond.js'
import { stockItemView, stockListView } from '../views/stockView.js'
import * as stockService from '../services/stock.service.js'

/** Thin by design: read the request, call the service, shape the response. */

function contextOf(req) {
  return { actor: req.staff, ip: req.ip ?? '' }
}

export async function list(req, res) {
  const { branch, items } = await stockService.list(req.validatedQuery, req.staff)

  // The branch is echoed back because an admin can act on any of them, and a sheet that
  // does not name the branch it describes is the one that gets toggled by mistake.
  return ok(res, {
    branch: { id: String(branch._id), code: branch.code, name: branch.name },
    items: stockListView(items),
  })
}

export async function setStock(req, res) {
  const { branch, product, row } = await stockService.setStock(
    req.params.productId,
    req.body,
    contextOf(req)
  )

  return ok(res, {
    branch: { id: String(branch._id), code: branch.code, name: branch.name },
    item: stockItemView({
      product,
      inStock: row.inStock,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    }),
  })
}
