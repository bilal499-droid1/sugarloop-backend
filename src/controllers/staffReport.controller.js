import { ok } from '../views/respond.js'
import { reportView } from '../views/reportView.js'
import { Branch } from '../models/Branch.js'
import * as reportService from '../services/report.service.js'
import { renderDailyReport, dailyReportFilename } from '../services/reportPdf.service.js'
import { sendPdf } from '../utils/sendPdf.js'

/** Thin by design: read the request, call the service, shape the response. */

export async function daily(req, res) {
  const report = await reportService.daily(req.validatedQuery, req.staff)

  return ok(res, { report: reportView.daily(report) })
}

export async function dailyPdf(req, res) {
  const report = await reportService.daily(req.validatedQuery, req.staff)

  return sendReportPdf(res, report)
}

export async function summary(req, res) {
  const report = await reportService.summary(req.validatedQuery, req.staff)

  return ok(res, { report: reportView.summary(report) })
}

export async function summaryPdf(req, res) {
  const report = await reportService.summary(req.validatedQuery, req.staff)

  return sendReportPdf(res, report)
}

/**
 * The branch comes off the REPORT, not the query: the service pins a manager to their own
 * branch regardless of what was asked for, so this names the branch whose numbers these
 * actually are.
 */
async function sendReportPdf(res, report) {
  const branch = report.branchId ? await Branch.findById(report.branchId, 'code name') : null
  const pdf = await renderDailyReport(report, { branch })

  return sendPdf(res, pdf, dailyReportFilename(report, branch))
}
