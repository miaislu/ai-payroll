import { useEffect, useRef, useState } from 'react'
import { PAGES, ROLE_VIEWS, PARENT, NAV, INITIAL_APPROVALS } from './data.js'
import { login, setToken, getApprovals, approvalAction, logout, checkBackend } from './api.js'
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
import { ApprovalsPage, BandApprovalPage, RaiseApprovalPage, OfferApprovalPage } from './pages/Approvals.jsx'
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
  recruiting: Recruiting, candidates: Candidates, requisitions: Requisitions, interviews: Interviews,
  channels: Channels, org: Org, cost: CostDashboard, budget: Budget, forecast: Forecast,
  'employee-profile': EmployeeProfile, equity: Equity, expenses: Expenses
}
const DEMO_ACCOUNTS = [
  { username: 'founder', password: 'admin123', label: '创始人' },
  { username: 'hr', password: 'hr123', label: 'HR' },
  { username: 'emp', password: 'emp123', label: '员工' }
]

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
        <div className="logo" style={{ padding: '0 0 16px' }}><span className="dot">薪</span>AI 薪酬 · 半导体</div>
        <label className="f" style={{ marginBottom: 10 }}>用户名
          <input value={u} onChange={e => setU(e.target.value)} placeholder="founder / hr / emp" />
        </label>
        <label className="f" style={{ marginBottom: 14 }}>密码
          <input type="password" value={p} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="••••••" />
        </label>
        <button className="btn primary" style={{ width: '100%', padding: 9 }} disabled={busy} onClick={submit}>{busy ? '登录中…' : '登 录'}</button>
        <div className="hint" style={{ marginTop: 14 }}>演示账号（一键登录）</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {DEMO_ACCOUNTS.map(a => (
            <button key={a.username} className="btn sm" style={{ flex: 1 }} onClick={() => onLogin(a.username, a.password)}>{a.label}</button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 12 }}>演示账号（点击下方一键登录）：创始人 / HR / 员工<br />生产环境请修改种子密码、启用 HTTPS 并配置登录限速</div>
      </div>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [empId, setEmpId] = useState(null)
  const [user, setUser] = useState(null)
  const [approvals, setApprovals] = useState(INITIAL_APPROVALS)
  const [toast, setToast] = useState(null)
  const [backendUp, setBackendUp] = useState(null)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { checkBackend().then(setBackendUp) }, [])
  const showToast = msg => {
    setToast(msg)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 2600)
  }

  const handleLogin = async (username, password) => {
    const u = await login(username, password)
    setToken(u.token)
    setUser(u)
    try { setApprovals(await getApprovals()) } catch { /* 审批失败不阻塞登录 */ }
    setPage(ROLE_VIEWS[u.role][0])
    showToast('欢迎，' + u.name)
  }
  const handleLogout = async () => {
    try { await logout() } catch { /* 忽略 */ }
    setToken('')
    setUser(null)
    setPage('dashboard')
  }

  if (!user) return (<><LoginScreen onLogin={handleLogin} toast={showToast} /><div id="toast" className={toast ? 'show' : ''}>{toast}</div></>)

  const role = user.role
  const goto = p => { const views = ROLE_VIEWS[role]; setPage(views.includes(p) ? p : views[0]); window.scrollTo({ top: 0 }) }
  const openProfile = id => { setEmpId(id); setPage('employee-profile'); window.scrollTo({ top: 0 }) }
  const act = async (id, status, newKey, comment) => {
    if (backendUp) {
      try { await approvalAction(id, status === 'approved' ? 'approve' : 'reject', newKey, comment); setApprovals(await getApprovals()); return }
      catch (error) { showToast('审批失败：' + error.message); return }
    }
    setApprovals(list => list.map(a => (a.id === id ? { ...a, status, key: newKey || a.key } : a)))
  }

  const pending = approvals.filter(a => a.status === 'pending').length
  const views = ROLE_VIEWS[role]
  const hl = PARENT[page] || page
  const ActivePage = PAGES_COMP[page]

  return (
    <div id="app">
      <aside id="sidebar">
        <div className="logo"><span className="dot">薪</span>AI 薪酬 · 半导体</div>
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
            {backendUp === false && <span className="chip bad">后端未连接 · 演示数据</span>}
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
        <span><span className="dot-live" />AI 薪酬系统 · 前后端 MVP</span>
        <span>{backendUp === true ? '数据来自后端 API（SQLite）' : '演示数据'}</span>
      </footer>
    </div>
  )
}
