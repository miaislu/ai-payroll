import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getUsers, getAuditLogs, createUser, resetUserPassword, deleteUser, getEmployees, getMarketSummary, ingestMarket } from '../api.js'
import { useDialog } from '../components/DialogProvider.jsx'

const EMPTY = { username: '', password: '', role: 'hr', name: '', employee_id: '' }

export default function Settings({ toast, backendUp, user }) {
  const { confirm: askConfirm } = useDialog()
  const isFounder = user?.role === 'founder'
  const canMarket = user?.role === 'founder' || user?.role === 'hr'
  const [users, setUsers] = useState(null)
  const [logs, setLogs] = useState(null)
  const [emps, setEmps] = useState([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [market, setMarket] = useState(null)
  const [csv, setCsv] = useState('')
  const [resetting, setResetting] = useState(null)
  const [resetPassword, setResetPassword] = useState('')

  const load = () => {
    if (!isFounder || !backendUp) return
    getUsers().then(setUsers).catch(() => toast('账号列表加载失败'))
    getAuditLogs(30).then(setLogs).catch(() => {})
    getEmployees().then(setEmps).catch(() => {})
  }

  useEffect(() => {
    if (!backendUp) return
    let alive = true
    if (isFounder) {
      getUsers().then(r => alive && setUsers(r)).catch(() => toast('账号列表加载失败'))
      getAuditLogs(30).then(r => alive && setLogs(r)).catch(() => {})
      getEmployees().then(r => alive && setEmps(r)).catch(() => {})
    }
    if (canMarket) getMarketSummary().then(r => alive && setMarket(r)).catch(() => {})
    return () => { alive = false }
  }, [isFounder, canMarket, backendUp])

  const saveUser = async () => {
    try {
      await createUser({
        ...form,
        employee_id: form.role === 'emp' ? Number(form.employee_id) || null : (form.employee_id ? Number(form.employee_id) : null)
      })
      toast('账号已创建')
      setAdding(false)
      setForm(EMPTY)
      load()
    } catch (e) { toast(e.message || '创建失败') }
  }
  const resetPw = async u => {
    setResetting(u)
    setResetPassword('')
  }
  const confirmResetPw = async () => {
    if (resetPassword.length < 12) return toast('密码至少 12 位')
    try {
      await resetUserPassword(resetting.id, resetPassword)
      toast('密码已重置，该账号其他会话已失效')
      setResetting(null)
      setResetPassword('')
      load()
    } catch (e) { toast(e.message || '重置失败') }
  }
  const remove = async u => {
    if (!await askConfirm({ title: '删除账号', message: `确认删除账号 ${u.username}？该账号之后将无法登录。`, confirmLabel: '删除账号' })) return
    try {
      await deleteUser(u.id)
      toast('已删除')
      load()
    } catch (e) { toast(e.message || '删除失败') }
  }

  return (
    <>
      <div className="grid g3">
        <Card title={<>岗位词典 <Chip kind="gray">只读种子</Chip></>}>
          <Hint>规范岗位与同义词目前写在代码/种子中，没有审核接口。点按钮不会改数据。</Hint>
          <Btn sm onClick={() => toast('词典管理尚未接入，当前为只读种子')}>查看说明</Btn>
        </Card>
        <Card title={<>政策知识库 <Chip kind="gray">city_policies.js</Chip></>}>
          <Hint>个税/社保/公积金参数按账期读取。当前内置数据仅供历史预览，未核验或不完整时会阻断正式月结。</Hint>
          <Btn sm onClick={() => toast('政策库管理尚未接入，请改 city_policies.js 后重启')}>查看说明</Btn>
        </Card>
        <Card title="对标数据源">
          <Hint>支持 CSV/JSON 导入样本并生成带宽草稿。猎聘/Boss 实时抓取未开通（{market?.scrape_enabled ? '开' : '关'}）。</Hint>
          <Hint style={{ marginTop: 6 }}>样本 {market?.total ?? '—'} 条{market?.last ? ` · 最近导入 ${market.last.created_at}（${market.last.source}）` : ''}</Hint>
          {canMarket && backendUp && (
            <>
              <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={5} style={{ width: '100%', marginTop: 8, fontFamily: 'monospace', fontSize: 12 }} placeholder={'direction,city,exp_band,annual_cash_wan,source\n模拟IC设计,上海,3-5年,55,import:csv'} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Btn sm onClick={async () => {
                  try {
                    const r = await ingestMarket({ csv, source: 'import:csv' })
                    toast(`已导入 ${r.imported} 条`)
                    setCsv('')
                    setMarket(await getMarketSummary())
                  } catch (e) { toast(e.message || '导入失败') }
                }}>导入 CSV</Btn>
              </div>
            </>
          )}
        </Card>
      </div>
      <Card title={<>权限与审计 <Chip kind="info">{isFounder ? 'CEO' : user?.role === 'hr' ? 'HR' : user?.role === 'finance' ? '财务' : '员工'}</Chip></>} style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>角色</th><th>可见范围</th><th>关键操作</th></tr></thead>
          <tbody>
            <tr><td>CEO</td><td>全部</td><td>审批兜底 · 账号 · 审计</td></tr>
            <tr><td>HR</td><td>人事与招聘</td><td>带宽审批 · 发起调薪/Offer/期权 · 不可锁定月结</td></tr>
            <tr><td>财务</td><td>算薪、成本、报销、发钱类审批</td><td>调薪/Offer/期权/报销审批 · 月结锁定</td></tr>
            <tr><td>员工</td><td>本人薪酬单 / 报销 / 考勤 / 绩效</td><td>只读本人数据；可提交报销</td></tr>
          </tbody>
        </table>
        <Hint style={{ marginTop: 8 }}>带宽由 HR 或 CEO 审批。调薪、期权、Offer、报销与月结由财务或 CEO 审批。账号与审计仅 CEO。对标靠样本导入，不做平台抓取。</Hint>
      </Card>
      {isFounder && (
        <div className="grid g2" style={{ marginTop: 14 }}>
          <Card title="账号" extra={<Btn sm onClick={() => setAdding(true)}>+ 新建</Btn>}>
            <table>
              <thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>关联员工</th><th></th></tr></thead>
              <tbody>
                {(users || []).map(u => (
                  <tr key={u.id}>
                    <td>{u.username}</td><td>{u.name}</td><td>{u.role}</td><td>{u.employee_id || '—'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <Btn sm onClick={() => resetPw(u)}>重置密码</Btn>
                      {u.id !== user.id && <Btn sm onClick={() => remove(u)}>删除</Btn>}
                    </td>
                  </tr>
                ))}
                {users && !users.length && <tr><td colSpan={5}><Hint>无账号</Hint></td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title="最近审计">
            <table>
              <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th></tr></thead>
              <tbody>
                {(logs || []).slice(0, 12).map(l => (
                  <tr key={l.id}><td className="hint">{String(l.created_at || '').slice(0, 16)}</td><td>{l.actor_name}</td><td>{l.action}</td><td>{l.entity_type} {l.entity_id}</td></tr>
                ))}
                {logs && !logs.length && <tr><td colSpan={4}><Hint>暂无审计</Hint></td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      )}
      {adding && (
        <Modal onClose={() => setAdding(false)}>
          <div className="modal">
            <h3>新建账号</h3>
            <Hint>密码至少 12 位。员工角色必须关联档案。</Hint>
            <div className="grid g2" style={{ marginTop: 10 }}>
              <Field label="用户名"><input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></Field>
              <Field label="姓名"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="密码"><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></Field>
              <Field label="角色">
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                  <option value="founder">CEO</option>
                  <option value="hr">HR</option>
                  <option value="finance">财务</option>
                  <option value="emp">员工</option>
                </select>
              </Field>
              <Field label="关联员工">
                <select value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })}>
                  <option value="">（无）</option>
                  {emps.map(e => <option key={e.id} value={e.id}>{e.name} · {e.grade}</option>)}
                </select>
              </Field>
            </div>
            <div className="row">
              <Btn onClick={() => setAdding(false)}>取消</Btn>
              <Btn primary onClick={saveUser}>创建</Btn>
            </div>
          </div>
        </Modal>
      )}
      {resetting && (
        <Modal onClose={() => setResetting(null)}>
          <div className="modal">
            <h3>重置密码 · {resetting.username}</h3>
            <Hint>新密码至少 12 位。提交后该账号已有会话会立即失效。</Hint>
            <Field label="新密码"><input type="password" autoComplete="new-password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} /></Field>
            <div className="row">
              <Btn onClick={() => setResetting(null)}>取消</Btn>
              <Btn primary onClick={confirmResetPw}>确认重置</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
