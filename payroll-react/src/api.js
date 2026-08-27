// API 客户端：对接 payroll-backend（后端未启动时调用方自行回退到本地演示数据）
const BASE = '/api'
let token = localStorage.getItem('payroll_token') || ''
export const setToken = t => { token = t; localStorage.setItem('payroll_token', t) }
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
  if (!res.ok) throw new Error('API ' + res.status + ' ' + path)
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
export const approvalAction = (id, action, key) => api('/approvals/' + id + '/action', { method: 'POST', body: { action, key } })
export const getBenchmarkDirections = () => api('/benchmarks/directions')
export const getBenchmarkCard = params => api('/benchmarks?' + new URLSearchParams(params).toString())
export const getPayroll = period => api('/payroll/' + period)
export const submitPayroll = period => api('/payroll/' + period + '/submit', { method: 'POST', body: {} })
export const askCopilot = (question, sessionId) => api('/copilot/ask', { method: 'POST', body: { question, sessionId } })
export const clearCopilot = sessionId => api('/copilot/clear', { method: 'POST', body: { sessionId } })
export const getPayslipMe = () => api('/payslip/me')
