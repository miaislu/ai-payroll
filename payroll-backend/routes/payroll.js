import { Router } from 'express'
import { audit, db, inTransaction } from '../db.js'
import { auth } from '../lib/auth.js'
import { missingExportFields } from '../lib/pii.js'
import { blockingPayrollIssues, fmtCsv, grantCliffPassed, livePayrollRows, payrollForPeriod, persistPayrollRows, presentPayroll } from '../lib/payroll_store.js'
import { FINANCE_ROLES, OPS_ROLES } from '../lib/access.js'
import { liveCompanyCostRows, persistCompanyCostSnapshot } from '../lib/cost_store.js'
import { currentPeriod } from '../lib/periods.js'

export const payroll = Router()

payroll.get('/payroll/:period', auth(OPS_ROLES), (req, res) => {
  const period = req.params.period
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(400).json({ error: 'period 须为 YYYY-MM 格式' })
  const { rows, run, live } = payrollForPeriod(period)
  const list = presentPayroll(rows)
  const total = rows.reduce((s, r) => s + r.net, 0)
  res.json({ period, rows: list, total: total.toLocaleString('zh-CN'), count: list.length, live, run })
})

payroll.post('/payroll/:period/submit', auth(FINANCE_ROLES), (req, res) => {
  const period = req.params.period
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(400).json({ error: 'period 须为 YYYY-MM' })
  const existing = db.prepare('SELECT * FROM payroll_runs WHERE period=?').get(period)
  if (existing) return res.status(409).json({ error: `该月工资已由 ${existing.submitted_by} 提交` })
  const rows = livePayrollRows(period)
  if (!rows.length) return res.status(409).json({ error: '该月没有可提交的工资数据' })
  const blockers = blockingPayrollIssues(rows)
  const overrideReason = String(req.body?.override_reason || '').trim()
  if (blockers.length && (req.user.role !== 'founder' || overrideReason.length < 10)) {
    return res.status(409).json({
      error: '工资预检存在未解决的阻断项；须先修正。仅 CEO 可在填写不少于 10 字的 override_reason 后例外提交。',
      blockers
    })
  }
  const now = new Date().toISOString()
  const costRows = liveCompanyCostRows(period)
  inTransaction(() => {
    persistPayrollRows(period, rows)
    persistCompanyCostSnapshot(period, costRows)
    db.prepare('INSERT INTO payroll_runs(period,status,submitted_by,submitted_at) VALUES(?,?,?,?)').run(period, 'submitted', req.user.name, now)
    audit(req.user, blockers.length ? 'submit_with_override' : 'submit', 'payroll_run', period, null, {
      period, status: 'submitted', submitted_at: now, count: rows.length,
      override_reason: blockers.length ? overrideReason : null,
      blockers: blockers.length ? blockers : null
    })
  })
  res.json({ ok: true, period, status: 'submitted', submitted_at: now })
})

payroll.get('/payroll/:period/export/:type', auth(FINANCE_ROLES), (req, res) => {
  const { period, type } = req.params
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(400).json({ error: 'period 须为 YYYY-MM' })
  if (!['tax', 'social', 'bank'].includes(type)) return res.status(400).json({ error: 'type 须为 tax/social/bank' })
  const { rows, run } = payrollForPeriod(period)
  if (!run) return res.status(409).json({ error: '税社核对或代发清单只能从已锁定的工资批次导出；请先完成财务月结' })
  if (!rows.length) return res.status(404).json({ error: '该月无工资单数据' })
  const blockers = blockingPayrollIssues(rows)
  if (blockers.length) return res.status(409).json({ error: '该锁定批次仍含阻断项，禁止生成申报或付款文件', blockers })
  const empRows = db.prepare('SELECT id, name, city, id_number, bank_account, special_deduction, supplemental_fund_rate FROM employees').all()
  const empMap = Object.fromEntries(empRows.map(e => [e.id, e]))
  const joined = rows.map(r => {
    const current = empMap[r.employee_id] || {}
    return {
      ...current,
      ...r,
      id_number: r.id_number || current.id_number,
      bank_account: r.bank_account || current.bank_account,
      city: r.city || current.city,
      special_deduction: r.special_deduction ?? current.special_deduction,
      supplemental_fund_rate: r.supplemental_fund_rate ?? current.supplemental_fund_rate
    }
  })
  if (type === 'tax' || type === 'bank') {
    const missing = missingExportFields(joined, type)
    if (missing.length) {
      const label = type === 'bank' ? '银行卡号' : '证件号码'
      return res.status(409).json({
        error: `${label}未录入或为脱敏占位，拒绝导出以免生成不可用的申报文件` + (missing.length ? `（${missing.slice(0, 8).join('、')}${missing.length > 8 ? ' 等' : ''}）` : ''),
        missing
      })
    }
  }
  let csv = '', filename = ''
  if (type === 'tax') {
    filename = `个税扣缴核对明细-${period}.csv`
    csv = fmtCsv([
      ['姓名', '证件号码', '当期工资薪金收入', '离职补偿（单独计税）', '当期基本减除费用', '当期专项扣除(社保公积金)', '当期专项附加扣除', '工资薪金当期预扣税额', '离职补偿税额', '当期税额合计', '实发工资'],
      ...joined.map(r => {
        const special = Number(r.special_deduction) || 0
        const deductSf = (r.social || 0) + (r.fund || 0) + (r.supplemental_fund || 0)
        const income = r.gross ?? ((r.base || 0) + (r.perf || 0) + (r.ot || 0))
        const severanceTax = r.severance_tax ?? 0
        const regularTax = r.regular_tax ?? Math.max(0, (r.tax || 0) - severanceTax)
        return [r.name, r.id_number, income, r.severance || 0, 5000, deductSf, special, regularTax, severanceTax, r.tax, r.net]
      })
    ])
  } else if (type === 'social') {
    filename = `社保公积金核对明细-${period}.csv`
    csv = fmtCsv([
      ['姓名', '城市', '社保缴费基数', '公积金缴费基数', '养老(个人)', '医疗(个人)', '失业(个人)', '公积金(个人)', '个人社保公积金合计'],
      ...joined.map(r => {
        if (!r.employment_type || r.personal_pension_rate == null || r.personal_medical_rate == null || r.personal_unemployment_rate == null) {
          throw Object.assign(new Error(`${r.name} 的锁定快照缺少逐险种费率，不能生成社保核对明细`), { statusCode: 409 })
        }
        const socialBase = r.social_base
        const fundBase = r.fund_base
        const pension = Math.round(socialBase * r.personal_pension_rate)
        const medical = Math.round(socialBase * r.personal_medical_rate)
        const unemp = Math.round(socialBase * r.personal_unemployment_rate)
        return [r.name, r.city || '', socialBase, fundBase, pension, medical, unemp, r.fund, (r.social || 0) + (r.fund || 0)]
      })
    ])
  } else {
    filename = `银行代发清单-${period}.csv`
    csv = fmtCsv([
      ['序号', '姓名', '银行卡号', '金额', '备注'],
      ...joined.map((r, i) => [i + 1, r.name, r.bank_account, r.net, `${period} 工资（已锁定批次）`])
    ])
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  res.send(csv)
})

payroll.get('/payslip/me', auth(), (req, res) => {
  const requested = req.query.employee_id ? Number(req.query.employee_id) : null
  let empId = req.user.employee_id
  if (requested && OPS_ROLES.includes(req.user.role)) empId = requested
  if (req.user.role === 'emp' && requested && Number(req.user.employee_id) !== requested) {
    return res.status(403).json({ error: '只能查看本人薪酬单' })
  }
  if (!empId) return res.status(404).json({ error: '未关联员工档案' })
  const e = db.prepare('SELECT * FROM employees WHERE id=?').get(empId)
  if (!e) return res.status(404).json({ error: '未关联员工档案' })
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.period || ''))
    ? req.query.period
    : (db.prepare('SELECT period FROM payroll WHERE employee_id=? ORDER BY period DESC LIMIT 1').get(e.id)?.period || currentPeriod())
  const { rows, run, live } = payrollForPeriod(period)
  const r = rows.find(x => Number(x.employee_id) === Number(e.id))
  if (!r) return res.status(404).json({ error: '该月无工资单数据' })
  const fund = r.fund, social = r.social, supFund = r.supplemental_fund || 0
  const items = [
    { label: '基本工资', value: r.base.toLocaleString('zh-CN') },
    { label: '绩效奖金', value: r.perf.toLocaleString('zh-CN') },
    { label: '加班费', value: r.ot ? r.ot.toLocaleString('zh-CN') : '0' },
    { label: '社保（个人）', value: (-social).toLocaleString('zh-CN') },
    { label: '基本公积金（个人）', value: (-fund).toLocaleString('zh-CN') }
  ]
  if (supFund > 0) items.push({ label: `补充公积金（个人 ${((e.supplemental_fund_rate || 0) * 100).toFixed(0)}%）`, value: (-supFund).toLocaleString('zh-CN') })
  items.push({ label: '个人所得税（累计预扣）', value: (-r.tax).toLocaleString('zh-CN') })
  const grants = db.prepare("SELECT * FROM option_grants WHERE employee_id=? AND status='granted'").all(e.id)
  const option = grants.length
    ? {
        granted: grants.reduce((s, g) => s + (g.share_count || 0) * 10000, 0),
        strike: grants[0].exercise_price,
        vested: grants.some(g => grantCliffPassed(g, period)) ? 'cliff 已过' : 'cliff 内',
        est_value: null
      }
    : null
  res.json({
    employee: { name: e.name, grade: e.grade, job_family: e.job_family },
    period,
    status: run?.status || 'preview',
    live,
    run,
    items,
    net: r.net.toLocaleString('zh-CN'),
    ai_note: '个税按累计预扣法计算（自然年累计收入减累计扣除后套用年度税率表，再减已预扣）。社保公积金按员工城市基数与费率。',
    option
  })
})
