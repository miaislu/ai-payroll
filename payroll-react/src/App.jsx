import { useEffect, useRef, useState } from 'react'
import { PAGES, ROLE_VIEWS, PARENT, NAV, CAN_APPROVE } from './data.js'
import { login, getMe, getApprovals, approvalAction, logout, checkBackend } from './api.js'
import { parseHash, toHash, resolvePage } from './lib/hash-route.js'
import Dashboard from './pages/Dashboard.jsx'
import Benchmark from './pages/Benchmark.jsx'
import Payroll from './pages/Payroll.jsx'
import Employees from './pages/Employees.jsx'
import EmployeeProfile from './pages/EmployeeProfile.jsx'
import Copilot from './pages/Copilot.jsx'
import Option from './pages/Option.jsx'
import Equity from './pages/Equity.jsx'
import Expenses from './pages/Expenses.jsx'
import Payslip from './pages/Payslip.jsx'
import Settings from './pages/Settings.jsx'
import { ApprovalsPage, BandApprovalPage, RaiseApprovalPage, OfferApprovalPage, OptionApprovalPage } from './pages/Approvals.jsx'
import Attendance from './pages/Attendance.jsx'
import Performance from './pages/Performance.jsx'
// v2 页面
import Recruiting from './pages/Recruiting.jsx'
import Candidates from './pages/Candidates.jsx'
import Requisitions from './pages/Requisitions.jsx'
import Interviews from './pages/Interviews.jsx'
import Channels from './pages/Channels.jsx'
import Org from './pages/Org.jsx'
import CostDashboard from './pages/CostDashboard.jsx'
import Budget from './pages/Budget.jsx'
import Forecast from './pages/Forecast.jsx'

const PAGES_COMP = {
  dashboard: Dashboard, benchmark: Benchmark, payroll: Payroll, employees: Employees, copilot: Copilot,
  option: Option, payslip: Payslip, settings: Settings, approvals: ApprovalsPage,
  'band-approval': BandApprovalPage, 'raise-approval': RaiseApprovalPage, 'offer-approval': OfferApprovalPage,
  'option-approval': OptionApprovalPage, attendance: Attendance, performance: Performance,
  recruiting: Recruiting, candidates: Candidates, requisitions: Requisitions, interviews: Interviews,
  channels: Channels, org: Org, cost: CostDashboard, budget: Budget, forecast: Forecast,
  'employee-profile': EmployeeProfile, equity: Equity, expenses: Expenses
}
const DEMO_ACCOUNTS = import.meta.env.DEV
  ? [
    { username: 'founder', password: 'admin123', label: 'CEO' },
    { username: 'hr', password: 'hr123', label: 'HR' },
    { username: 'finance', password: 'finance123', label: '财务' },
    { username: 'emp', password: 'emp123', label: '员工' }
  ]
  : []

function LoginScreen({ onLogin, toast }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!u || !p) return toast('请输入用户名和密码')
    setBusy(true)
    try { await onLogin(u, p) } catch (e) { toast(e.message.includes('401') ? '用户名或密码错误' : '登录失败：' + e.message) } finally { setBusy(false) }
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div className="card" style={{ width: 380 }}>
        <div className="logo" style={{ padding: '0 0 16px' }}><span className="dot">人</span>小公司人力</div>
        <label className="f" style={{ marginBottom: 10 }}>用户名
          <input value={u} onChange={e => setU(e.target.value)} placeholder="用户名" />
        </label>
        <label className="f" style={{ marginBottom: 14 }}>密码
          <input type="password" value={p} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="••••••" />
        </label>
        <button className="btn primary" style={{ width: '100%', padding: 9 }} disabled={busy} onClick={submit}>{busy ? '登录中…' : '登 录'}</button>
        {DEMO_ACCOUNTS.length > 0 && (
          <>
            <div className="hint" style={{ marginTop: 14 }}>本地开发演示账号（不会打进生产包）</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {DEMO_ACCOUNTS.map(a => (
                <button key={a.username} className="btn sm" style={{ flex: 1 }} onClick={() => onLogin(a.username, a.password)}>{a.label}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [empId, setEmpId] = useState(null)
  const [user, setUser] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [toast, setToast] = useState(null)
  const [backendUp, setBackendUp] = useState(null)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    let alive = true
    ;(async () => {
      const up = await checkBackend()
      if (!alive) return
      setBackendUp(up)
      if (!up) return
      try {
        const me = await getMe()
        if (!alive) return
        setUser(me)
        try { setApprovals(await getApprovals()) } catch { /* emp 无审批列表 */ }
      } catch { /* 未登录 */ }
    })()
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!user) return
    const apply = () => {
      const parsed = parseHash(window.location.hash)
      const next = resolvePage(user.role, parsed.page, parsed.empId)
      setPage(next.page)
      setEmpId(next.empId)
      const hash = toHash(next.page, next.empId)
      if (window.location.hash !== hash) history.replaceState(null, '', hash)
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [user])
  const showToast = msg => {
    setToast(msg)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 2600)
  }

  const handleLogin = async (username, password) => {
    const u = await login(username, password)
    setUser(u)
    try { setApprovals(await getApprovals()) } catch { /* 审批失败不阻塞登录 */ }
    const parsed = parseHash(window.location.hash)
    const next = resolvePage(u.role, parsed.page, parsed.empId)
    history.replaceState(null, '', toHash(next.page, next.empId))
    showToast('欢迎，' + u.name)
  }
  const handleLogout = async () => {
    try { await logout() } catch { /* 忽略 */ }
    setUser(null)
    setApprovals([])
    history.replaceState(null, '', '#/dashboard')
  }

  if (!user) return (<><LoginScreen onLogin={handleLogin} toast={showToast} /><div id="toast" className={toast ? 'show' : ''}>{toast}</div></>)

  const role = user.role
  const goto = (p, id) => {
    const next = resolvePage(role, p, id ?? empId)
    const hash = toHash(next.page, next.empId)
    if (window.location.hash !== hash) window.location.hash = hash
    else { setPage(next.page); setEmpId(next.empId) }
    window.scrollTo({ top: 0 })
  }
  const openProfile = id => goto('employee-profile', id)
  const act = async (id, status, newKey, comment, extra) => {
    if (!backendUp) return showToast('后端不可用，审批未提交')
    try { await approvalAction(id, status === 'approved' ? 'approve' : 'reject', newKey, comment, extra); setApprovals(await getApprovals()) }
    catch (error) { showToast('审批失败：' + error.message) }
  }

  const pending = approvals.filter(a => a.status === 'pending' && CAN_APPROVE(role, a.type)).length
  const views = ROLE_VIEWS[role]
  const hl = PARENT[page] || page
  const ActivePage = PAGES_COMP[page]

  return (
    <div id="app">
      <aside id="sidebar">
        <div className="logo"><span className="dot">人</span>小公司人力</div>
        {NAV.map((item, i) => item.group ? (
          <div className="nav-sep" key={i}>{item.group}</div>
        ) : views.includes(item.page) && (
          <div key={item.page} className={`nav-item ${hl === item.page ? 'active' : ''}`} onClick={() => goto(item.page)}>
            <span className="ico">{item.ico}</span>{item.label}
            {item.badge && <span className="badge" style={{ display: pending ? 'inline' : 'none' }}>{pending}</span>}
          </div>
        ))}
      </aside>

      <main id="main">
        <div className="topbar">
          <div className="page-title">
            <h1>{PAGES[page][0]}</h1>
            <p>{PAGES[page][1]}</p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {backendUp === false && <span className="chip bad">后端未连接 · 数据不可用</span>}
            {backendUp === true && <span className="chip ok">● 已连接后端</span>}
            <span className="chip info">👤 {user.name}（{user.username}）</span>
            <button className="btn sm" onClick={handleLogout}>退出</button>
          </div>
        </div>
        <div className="page active">
          <ActivePage goto={goto} toast={showToast} approvals={approvals} act={act} backendUp={backendUp} user={user} empId={empId} openProfile={openProfile} />
        </div>
      </main>

      <button id="fab" onClick={() => goto('copilot')} title="AI 助手">💬</button>
      <div id="toast" className={toast ? 'show' : ''}>{toast}</div>
      <footer>
        <span><span className="dot-live" />小公司人力管理系统</span>
        <span>{backendUp === true ? '数据来自后端 API（SQLite）' : '未连接数据源'}</span>
      </footer>
    </div>
  )
}
