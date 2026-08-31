// API 客户端：对接 payroll-backend（后端未启动时调用方自行回退到本地演示数据）
const BASE = '/api'
let token = sessionStorage.getItem('payroll_token') || ''
export const setToken = t => { token = t; if (t) sessionStorage.setItem('payroll_token', t); else sessionStorage.removeItem('payroll_token') }
export const getToken = () => token

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error || ('API ' + res.status + ' ' + path))
  }
  return res.json()
}

// 后端是否可用（供前端降级提示）
export async function checkBackend() {
  try {
    const r = await fetch(BASE + '/health')
    return r.ok
  } catch { return false }
}

export const login = (username, password) => api('/auth/login', { method: 'POST', body: { username, password }, auth: false })
export const logout = () => api('/auth/logout', { method: 'POST', body: {} })
export const getEmployees = () => api('/employees')
export const createEmployee = body => api('/employees', { method: 'POST', body })
export const updateEmployee = (id, body) => api('/employees/' + id, { method: 'PUT', body })
export const deleteEmployee = id => api('/employees/' + id, { method: 'DELETE' })
export const getApprovals = () => api('/approvals')
export const approvalAction = (id, action, key, comment) => api('/approvals/' + id + '/action', { method: 'POST', body: { action, key, comment } })
export const getBenchmarkDirections = () => api('/benchmarks/directions')
export const getBenchmarkCard = params => api('/benchmarks?' + new URLSearchParams(params).toString())
export const getPayroll = period => api('/payroll/' + period)
export const submitPayroll = period => api('/payroll/' + period + '/submit', { method: 'POST', body: {} })
export const askCopilot = (question, sessionId) => api('/copilot/ask', { method: 'POST', body: { question, sessionId } })
export const clearCopilot = sessionId => api('/copilot/clear', { method: 'POST', body: { sessionId } })
export const getPayslipMe = () => api('/payslip/me')

// ── v2：组织架构 ──
export const getDepartments = () => api('/departments')
export const createDepartment = body => api('/departments', { method: 'POST', body })
export const updateDepartment = (id, body) => api('/departments/' + id, { method: 'PUT', body })
export const deleteDepartment = id => api('/departments/' + id, { method: 'DELETE' })
export const getOrgOverview = () => api('/org/overview')
export const getEmployeeEvents = id => api('/employees/' + id + '/events')
export const createEmployeeEvent = (id, body) => api('/employees/' + id + '/events', { method: 'POST', body })
export const deleteEmployeeEvent = id => api('/events/' + id, { method: 'DELETE' })

// ── v3：员工完整档案 ──
export const getEmployeeProfile = id => api('/employees/' + id + '/profile')
export const updateEmployeeProfile = (id, body) => api('/employees/' + id + '/profile', { method: 'PUT', body })
export const getEmergencyContacts = id => api('/employees/' + id + '/emergency-contacts')
export const createEmergencyContact = (id, body) => api('/employees/' + id + '/emergency-contacts', { method: 'POST', body })
export const updateEmergencyContact = (cid, body) => api('/employees/emergency-contacts/' + cid, { method: 'PUT', body })
export const deleteEmergencyContact = cid => api('/employees/emergency-contacts/' + cid, { method: 'DELETE' })
export const getEducation = id => api('/employees/' + id + '/education')
export const createEducation = (id, body) => api('/employees/' + id + '/education', { method: 'POST', body })
export const deleteEducation = eid => api('/employees/education/' + eid, { method: 'DELETE' })
export const getWorkExperience = id => api('/employees/' + id + '/work-experience')
export const createWorkExperience = (id, body) => api('/employees/' + id + '/work-experience', { method: 'POST', body })
export const deleteWorkExperience = wid => api('/employees/work-experience/' + wid, { method: 'DELETE' })
export const getFamily = id => api('/employees/' + id + '/family')
export const createFamily = (id, body) => api('/employees/' + id + '/family', { method: 'POST', body })
export const deleteFamily = fid => api('/employees/family/' + fid, { method: 'DELETE' })

// ── v4：简历附件与 AI 解析 ──
export const getResumes = id => api('/employees/' + id + '/resume')
export const uploadResume = (id, file) => {
  const fd = new FormData()
  fd.append('resume', file)
  return fetch(BASE + '/employees/' + id + '/resume', {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: fd
  }).then(async r => {
    if (!r.ok) throw new Error('上传失败 ' + r.status)
    return r.json()
  })
}
export const parseResume = (id, rid, allowExternal = false) => api('/employees/' + id + '/resume/' + rid + '/parse', { method: 'POST', body: { allow_external: allowExternal } })
export const applyResume = (id, rid) => api('/employees/' + id + '/resume/' + rid + '/apply', { method: 'POST', body: {} })
export const deleteResume = (id, rid) => api('/employees/' + id + '/resume/' + rid, { method: 'DELETE' })
export const downloadAuthenticated = async (path, filename) => {
  const res = await fetch(BASE + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} })
  if (!res.ok) throw new Error('下载失败 ' + res.status)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url; a.download = filename || 'download'; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const downloadResume = (id, rid, filename) => downloadAuthenticated('/employees/' + id + '/resume/' + rid + '/file', filename)

// ── v2：招聘管理 ──
export const getRequisitions = () => api('/recruiting/requisitions')
export const createRequisition = body => api('/recruiting/requisitions', { method: 'POST', body })
export const updateRequisition = (id, body) => api('/recruiting/requisitions/' + id, { method: 'PUT', body })
export const deleteRequisition = id => api('/recruiting/requisitions/' + id, { method: 'DELETE' })
export const getCandidates = () => api('/recruiting/candidates')
export const getCandidatesKanban = () => api('/recruiting/candidates/kanban')
export const createCandidate = body => api('/recruiting/candidates', { method: 'POST', body })
export const updateCandidate = (id, body) => api('/recruiting/candidates/' + id, { method: 'PUT', body })
export const deleteCandidate = id => api('/recruiting/candidates/' + id, { method: 'DELETE' })
export const setCandidateStage = (id, body) => api('/recruiting/candidates/' + id + '/stage', { method: 'POST', body })
export const onboardCandidate = (id, body) => api('/recruiting/candidates/' + id + '/onboard', { method: 'POST', body })
export const getInterviews = () => api('/recruiting/interviews')
export const createInterview = body => api('/recruiting/interviews', { method: 'POST', body })
export const updateInterview = (id, body) => api('/recruiting/interviews/' + id, { method: 'PUT', body })
export const deleteInterview = id => api('/recruiting/interviews/' + id, { method: 'DELETE' })
export const getChannels = () => api('/recruiting/channels')
export const createChannel = body => api('/recruiting/channels', { method: 'POST', body })
export const updateChannel = (id, body) => api('/recruiting/channels/' + id, { method: 'PUT', body })
export const deleteChannel = id => api('/recruiting/channels/' + id, { method: 'DELETE' })
export const createChannelExpense = body => api('/recruiting/channel-expenses', { method: 'POST', body })
export const deleteChannelExpense = id => api('/recruiting/channel-expenses/' + id, { method: 'DELETE' })
export const getRecruitingStats = () => api('/recruiting/stats')
export const getOfferSuggest = params => api('/recruiting/offer/suggest?' + new URLSearchParams(params).toString())

// ── v5：候选人简历 AI 解析 + Offer 审批 ──
export const createOfferApproval = (id, body) => api('/recruiting/candidates/' + id + '/offer-approval', { method: 'POST', body })
export const uploadCandidateResume = (id, file) => {
  const fd = new FormData()
  fd.append('resume', file)
  return fetch(BASE + '/recruiting/candidates/' + id + '/resume', {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: fd
  }).then(async r => {
    if (!r.ok) throw new Error('上传失败 ' + r.status)
    return r.json()
  })
}
export const parseCandidateResume = (id, allowExternal = false) => api('/recruiting/candidates/' + id + '/resume/parse', { method: 'POST', body: { allow_external: allowExternal } })
export const deleteCandidateResume = id => api('/recruiting/candidates/' + id + '/resume', { method: 'DELETE' })
export const downloadCandidateResume = (id, filename) => downloadAuthenticated('/recruiting/candidates/' + id + '/resume', filename)

// ── v2：薪酬成本管理 ──
export const getCostSummary = period => api('/cost/summary' + (period ? '?period=' + period : ''))
export const getCostTrend = months => api('/cost/trend?months=' + (months || 6))
export const getCostBudget = period => api('/cost/budget' + (period ? '?period=' + period : ''))
export const getCostForecast = (months, start) => api('/cost/forecast?months=' + (months || 6) + (start ? '&start=' + start : ''))
export const getCostUnit = period => api('/cost/unit' + (period ? '?period=' + period : ''))
export const getBudgets = yearMonth => api('/cost/budgets' + (yearMonth ? '?year_month=' + yearMonth : ''))
export const createBudget = body => api('/cost/budgets', { method: 'POST', body })
export const updateBudget = (id, body) => api('/cost/budgets/' + id, { method: 'PUT', body })
export const deleteBudget = id => api('/cost/budgets/' + id, { method: 'DELETE' })
export const getHeadcountPlans = () => api('/cost/headcount-plans')
export const createHeadcountPlan = body => api('/cost/headcount-plans', { method: 'POST', body })
export const deleteHeadcountPlan = id => api('/cost/headcount-plans/' + id, { method: 'DELETE' })

// ── v6：期权授予台账 ──
export const getEquityPool = () => api('/equity/pool')
export const updateEquityPool = body => api('/equity/pool', { method: 'PUT', body })
export const getEquityGrants = employeeId => api('/equity/grants' + (employeeId ? '?employee_id=' + employeeId : ''))
export const createEquityGrant = body => api('/equity/grants', { method: 'POST', body })
export const updateEquityGrant = (id, body) => api('/equity/grants/' + id, { method: 'PUT', body })
export const deleteEquityGrant = id => api('/equity/grants/' + id, { method: 'DELETE' })
export const getEquitySummary = () => api('/equity/summary')

// ── v8：报销与预支 ──
export const getExpenseClaims = () => api('/expense/claims')
export const createExpenseClaim = body => api('/expense/claims', { method: 'POST', body })
export const expenseClaimAction = (id, body) => api('/expense/claims/' + id + '/action', { method: 'POST', body })
export const deleteExpenseClaim = id => api('/expense/claims/' + id, { method: 'DELETE' })
export const getAdvances = () => api('/expense/advances')
export const createAdvance = body => api('/expense/advances', { method: 'POST', body })
export const advanceAction = (id, body) => api('/expense/advances/' + id + '/action', { method: 'POST', body })
export const deleteAdvance = id => api('/expense/advances/' + id, { method: 'DELETE' })
