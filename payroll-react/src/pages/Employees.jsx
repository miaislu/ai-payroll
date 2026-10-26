import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getEmployees, createEmployee, updateEmployee, deleteEmployee, getEmployeeEvents, createEmployeeEvent, deleteEmployeeEvent,
  getCandidates, getRequisitions, uploadResume } from '../api.js'
import { CITIES } from '../data.js'
import { JOB_CATALOG, SPECIAL_DEDUCTIONS, categoryForJob, monthlySpecialDeductionTotal, parseSpecialDeductions } from '../jobCatalog.js'
import { currentDate, currentPeriod } from '../lib/period.js'
import { useDialog } from '../components/DialogProvider.jsx'

const CAT_LABEL = { tech: '技术', support: '职能', mgmt: '管理' }
const ETYPE_LABEL = { employee: '正式', consultant: '顾问', intern: '实习生' }
const EVENT_TYPES = [
  { key: 'onboard', label: '入职' }, { key: 'regularize', label: '转正' },
  { key: 'promotion', label: '晋升' }, { key: 'transfer', label: '调动' },
  { key: 'offboard', label: '离职' }
]
const emptyEmployee = () => ({
  name: '', grade: 'P4', job_family: JOB_CATALOG.tech.jobs[0], city: '上海', monthly_base: 20000,
  fixed_salary_months: 12, annual_bonus_months: 0, perf_ratio: 0.3,
  special_deduction: 0, special_deductions: {}, hire_date: currentDate(), hire_month: currentPeriod(),
  leave_date: '', leave_month: '', effective_month: currentPeriod(), severance_amount: 0,
  department_id: null, category: 'tech', status: 'active', employment_type: 'employee', supplemental_fund_rate: 0
})
const EV_EMPTY = { type: 'onboard', event_date: '', from_value: '', to_value: '', note: '' }

export default function Employees({ toast, backendUp, openProfile }) {
  const { confirm: askConfirm } = useDialog()
  const [list, setList] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyEmployee)
  const [confirmDel, setConfirmDel] = useState(null)
  const [eventView, setEventView] = useState(null) // 员工事件面板
  const [events, setEvents] = useState([])
  const [evForm, setEvForm] = useState(EV_EMPTY)
  const [acceptedCandidates, setAcceptedCandidates] = useState([])
  const [requisitions, setRequisitions] = useState([])
  const [profileFile, setProfileFile] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try { setList(await getEmployees()) } catch { setList([]); toast('员工列表加载失败（后端不可用）') }
  }
  useEffect(() => { load() }, [backendUp])

  const open = async mode => {
    const value = mode === 'new'
      ? emptyEmployee()
      : {
          ...mode,
          category: mode.category || categoryForJob(mode.job_family),
          fixed_salary_months: Number(mode.fixed_salary_months ?? 12),
          annual_bonus_months: Number(mode.annual_bonus_months ?? 0),
          special_deductions: parseSpecialDeductions(mode.special_deductions_json, mode.special_deduction),
          hire_date: mode.hire_date || `${mode.hire_month}-01`,
          leave_date: mode.leave_date || '',
          effective_month: currentPeriod()
        }
    setForm(value)
    setProfileFile(null)
    setEditing(mode)
    if (mode === 'new') {
      try {
        const [candidates, reqs] = await Promise.all([getCandidates(), getRequisitions()])
        setAcceptedCandidates(candidates.filter(item => item.stage === 'accepted' && !item.employee_id))
        setRequisitions(reqs)
      } catch { setAcceptedCandidates([]) }
    }
  }
  const pickCandidate = id => {
    const candidate = acceptedCandidates.find(item => item.id === Number(id))
    if (!candidate) return setForm(emptyEmployee())
    const req = requisitions.find(item => item.id === candidate.requisition_id)
    const job = req?.job_family || emptyEmployee().job_family
    setForm({ ...emptyEmployee(), candidate_id: candidate.id, name: candidate.name,
      job_family: job, category: categoryForJob(job), city: req?.city || '上海', monthly_base: candidate.offer_amount,
      fixed_salary_months: Number(req?.fixed_salary_months ?? 12), annual_bonus_months: Number(req?.annual_bonus_months ?? 0),
      employment_type: req?.employment_type || 'employee' })
  }
  const set = k => e => setForm({ ...form, [k]: ['monthly_base', 'fixed_salary_months', 'annual_bonus_months', 'perf_ratio', 'supplemental_fund_rate', 'severance_amount'].includes(k) ? (e.target.value === '' ? null : +e.target.value) : e.target.value })
  const setCategory = e => {
    const category = e.target.value
    setForm({ ...form, category, job_family: JOB_CATALOG[category].jobs[0] })
  }
  const setDeduction = (def, enabled, amount) => {
    const next = { ...(form.special_deductions || {}) }
    if (enabled) {
      if (def.key === 'housing_loan') delete next.housing_rent
      if (def.key === 'housing_rent') delete next.housing_loan
      next[def.key] = { enabled: true, amount: Number(amount ?? def.defaultAmount(form.city)) || 0 }
    } else delete next[def.key]
    setForm({ ...form, special_deductions: next, special_deduction: monthlySpecialDeductionTotal(next) })
  }

  const save = async () => {
    if (!form.name.trim()) return toast('姓名必填')
    if (saving) return
    setSaving(true)
    try {
      const payload = { ...form, special_deduction: monthlySpecialDeductionTotal(form.special_deductions), grade: form.grade || 'P4', department_id: form.department_id || null }
      let id
      if (editing === 'new') {
        const created = await createEmployee(payload)
        id = created.id
        toast(form.candidate_id ? '已从简历库关联建立员工档案' : '已新增员工')
      }
      else { await updateEmployee(editing.id, payload); toast('已保存修改') }
      if (id && profileFile) {
        try { await uploadResume(id, profileFile) } catch { toast('员工已建档，但新附件上传失败；请在完整档案中重新上传') }
      }
      setEditing(null); load()
      if (id) openProfile(id)
    } catch (e) {
      toast('保存失败：' + e.message)
    } finally { setSaving(false) }
  }
  const del = async () => {
    try { await deleteEmployee(confirmDel.id); toast('已删除 ' + confirmDel.name); setConfirmDel(null); load() }
    catch { toast('删除失败') }
  }

  const openEvents = async e => {
    setEventView(e)
    setEvForm(EV_EMPTY)
    try { setEvents(await getEmployeeEvents(e.id)) } catch { setEvents([]) }
  }
  const addEvent = async () => {
    if (!evForm.event_date) return toast('选择事件日期')
    try {
      await createEmployeeEvent(eventView.id, evForm)
      toast('已记录事件')
      setEvForm(EV_EMPTY)
      setEvents(await getEmployeeEvents(eventView.id))
    } catch { toast('记录失败') }
  }
  const delEvent = async id => {
    if (!await askConfirm({ title: '删除员工事件', message: '删除后对应的入转调离记录将从档案中移除。', confirmLabel: '删除' })) return
    try { await deleteEmployeeEvent(id); setEvents(await getEmployeeEvents(eventView.id)) } catch { toast('删除失败') }
  }

  const eventLabel = k => EVENT_TYPES.find(t => t.key === k)?.label || k

  return (
    <>
      <Card title={<>员工档案 <Chip kind="info">{list?.length || 0} 人</Chip></>}>
        <div className="toolbar">
          <Hint>员工档案（岗位分类 / 薪酬包 / 专项附加扣除）→ 算薪与成本自动联动</Hint>
          <div style={{ flex: 1 }} />
          <Btn primary onClick={() => open('new')}>+ 新增员工</Btn>
        </div>
        <table>
          <thead><tr><th>姓名</th><th>大类</th><th>具体岗位</th><th>用工</th><th>城市</th><th>月薪</th><th>固定薪资</th><th>年终奖约定</th><th>目标年现金</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>{list?.map(e => (
            <tr key={e.id}>
              <td><b>{e.name}</b></td>
              <td><Chip kind={e.category === 'tech' ? 'info' : e.category === 'support' ? 'gray' : 'warn'}>{CAT_LABEL[e.category] || '技术'}</Chip></td>
              <td>{e.job_family}</td>
              <td>{e.employment_type === 'consultant' ? <Chip kind="warn">顾问</Chip> : e.employment_type === 'intern' ? <Chip kind="info">实习生</Chip> : <Chip kind="ok">正式</Chip>}</td>
              <td>{e.city}</td>
              <td>¥{e.monthly_base.toLocaleString('zh-CN')}</td>
              <td>{Number(e.fixed_salary_months ?? 12)} 个月</td>
              <td>{Number(e.annual_bonus_months ?? 0)} 个月</td>
              <td>¥{Math.round(e.monthly_base * (Number(e.fixed_salary_months ?? 12) + Number(e.annual_bonus_months ?? 0))).toLocaleString('zh-CN')}</td>
              <td>{e.status === 'departed' ? <Chip kind="warn">离职</Chip> : e.status === 'offer' ? <Chip kind="info">发offer</Chip> : <Chip kind="ok">在职</Chip>}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <Btn sm onClick={() => openProfile(e.id)}>档案</Btn>
                <Btn sm onClick={() => open(e)}>编辑</Btn>
                <Btn sm onClick={() => openEvents(e)}>事件</Btn>
                <Btn sm onClick={() => setConfirmDel(e)}>删除</Btn>
              </td>
            </tr>
          ))}
          {list && !list.length && <tr><td colSpan={11}><Hint>暂无员工（后端不可用或数据为空）</Hint></td></tr>}
          </tbody>
        </table>
      </Card>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div className="modal" style={{ width: 720, maxHeight: '88vh', overflowY: 'auto' }}>
            <h3>{editing === 'new' ? '新增员工' : '编辑员工 · ' + editing.name}</h3>
            {editing === 'new' && <>
              <Field label="关联已录用人选（简历库）">
                <select value={form.candidate_id || ''} onChange={e => pickCandidate(e.target.value)}>
                  <option value="">— 不关联，手动新建 —</option>
                  {acceptedCandidates.map(item => <option key={item.id} value={item.id}>{item.name}（{item.requisition_title || '未关联岗位'}）</option>)}
                </select>
              </Field>
              <Hint style={{ margin: '8px 0 12px' }}>{form.candidate_id ? '已带入人选信息与已审批 Offer。保存后简历一并归入员工档案，可继续补充或更新资料。' : '简历库人选确认录用后，会出现在这里；每位人选仅可关联一个员工档案。'}</Hint>
            </>}
            <div className="grid g2">
              <Field label="姓名"><input value={form.name} onChange={set('name')} placeholder="必填" /></Field>
              <Field label="岗位大类"><select value={form.category} onChange={setCategory}>{Object.entries(JOB_CATALOG).map(([key, group]) => <option key={key} value={key}>{group.label}</option>)}</select></Field>
              <Field label="具体岗位"><select value={form.job_family} onChange={set('job_family')}>{JOB_CATALOG[form.category]?.jobs.map(k => <option key={k}>{k}</option>)}</select></Field>
              <Field label="城市"><select value={form.city} onChange={set('city')}>{Object.keys(CITIES).map(k => <option key={k}>{k}</option>)}</select></Field>
              <Field label="用工类型">
                <select value={form.employment_type || 'employee'} onChange={set('employment_type')}>
                  <option value="employee">正式员工</option>
                  <option value="consultant">顾问（劳务报酬）</option>
                  <option value="intern">实习生</option>
                </select>
              </Field>
              <Field label="月薪（元）"><input type="number" value={form.monthly_base} readOnly={Boolean(form.candidate_id)} onChange={set('monthly_base')} min={2000} /></Field>
              <Field label="全年固定薪资月数"><select value={form.fixed_salary_months} onChange={set('fixed_salary_months')}>{[12, 13, 14, 15, 16, 17, 18].map(n => <option key={n} value={n}>{n} 个月</option>)}</select></Field>
              <Field label="年终奖约定月数"><select value={form.annual_bonus_months} onChange={set('annual_bonus_months')}>{[0, 0.5, 1, 1.5, 2, 3, 4, 6].map(n => <option key={n} value={n}>{n} 个月</option>)}</select></Field>
              <Field label="绩效比例（0-1）"><input type="number" step="0.01" value={form.perf_ratio} onChange={set('perf_ratio')} /></Field>
              <Field label="补充公积金比例（0-0.08）"><input type="number" step="0.01" min="0" max="0.08" value={form.supplemental_fund_rate ?? 0} onChange={set('supplemental_fund_rate')} /></Field>
              <Field label="入职日期"><input type="date" value={form.hire_date || ''} onChange={set('hire_date')} /></Field>
              {editing !== 'new' && <Field label="薪酬变更生效月份"><input type="month" value={form.effective_month || currentPeriod()} onChange={set('effective_month')} /></Field>}
              <Field label="状态"><select value={form.status || 'active'} onChange={set('status')}><option value="active">在职</option><option value="offer">待入职</option><option value="departed">离职</option></select></Field>
              {form.status === 'departed' && <Field label="离职日期"><input type="date" value={form.leave_date || ''} onChange={set('leave_date')} /></Field>}
              {form.status === 'departed' && <Field label="离职补偿（显式金额）"><input type="number" min="0" value={form.severance_amount || 0} onChange={set('severance_amount')} /></Field>}
            </div>
            {editing === 'new' && <Field label="上传最新简历 / 更新资料（可选）">
              <input type="file" accept=".txt,.md,.text,.docx,.pdf,.xlsx,.xls" onChange={e => setProfileFile(e.target.files?.[0] || null)} />
            </Field>}
            <Hint style={{ margin: '10px 0' }}>年固定现金 ¥{Math.round((form.monthly_base || 0) * (form.fixed_salary_months || 0)).toLocaleString('zh-CN')}；含约定年终奖的目标年现金 ¥{Math.round((form.monthly_base || 0) * ((form.fixed_salary_months || 0) + (form.annual_bonus_months || 0))).toLocaleString('zh-CN')}。年终奖仅记录约定，不自动并入每月工资。</Hint>
            <div className="nav-sep" style={{ padding: '10px 0 4px' }}>专项附加扣除（每月合计 ¥{monthlySpecialDeductionTotal(form.special_deductions).toLocaleString('zh-CN')}）</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {SPECIAL_DEDUCTIONS.filter(def => !def.legacy || form.special_deductions?.[def.key]?.enabled).map(def => {
                const selected = Boolean(form.special_deductions?.[def.key]?.enabled)
                const amount = form.special_deductions?.[def.key]?.amount ?? def.defaultAmount(form.city)
                return <div key={def.key} style={{ display: 'grid', gridTemplateColumns: '24px 190px 120px 1fr', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={selected} onChange={ev => setDeduction(def, ev.target.checked, amount)} />
                  <span>{def.label}</span>
                  <input type="number" min="0" disabled={!selected} value={amount} onChange={ev => setDeduction(def, true, ev.target.value)} />
                  <Hint>{def.annual ? '年度金额 · ' : '每月金额 · '}{def.note}</Hint>
                </div>
              })}
            </div>
            <div className="row">
              <Btn onClick={() => setEditing(null)}>取消</Btn>
              <Btn primary disabled={saving} onClick={save}>{saving ? '保存中…' : '保存'}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {eventView && (
        <Modal onClose={() => setEventView(null)}>
          <div className="modal" style={{ width: 560, maxHeight: '86vh', overflowY: 'auto' }}>
            <h3>入转调离 · {eventView.name}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {events.map(ev => (
                <div key={ev.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Chip kind={ev.type === 'offboard' ? 'warn' : ev.type === 'onboard' ? 'ok' : 'info'}>{eventLabel(ev.type)}</Chip>
                  <span>{ev.event_date}</span>
                  <span className="hint">{ev.from_value ? ev.from_value + ' → ' : ''}{ev.to_value || ''} {ev.note}</span>
                  <span style={{ marginLeft: 'auto', color: '#dc2626', cursor: 'pointer' }} onClick={() => delEvent(ev.id)}>✕</span>
                </div>
              ))}
              {!events.length && <Hint>暂无事件记录</Hint>}
            </div>
            <div className="grid g2">
              <Field label="类型">
                <select value={evForm.type} onChange={e => setEvForm({ ...evForm, type: e.target.value })}>
                  {EVENT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="日期"><input type="date" value={evForm.event_date} onChange={e => setEvForm({ ...evForm, event_date: e.target.value })} /></Field>
              <Field label="变更前"><input value={evForm.from_value} onChange={e => setEvForm({ ...evForm, from_value: e.target.value })} placeholder="如：P4 / 数字前端组" /></Field>
              <Field label="变更后"><input value={evForm.to_value} onChange={e => setEvForm({ ...evForm, to_value: e.target.value })} placeholder="如：P5 / 模拟设计组" /></Field>
              <Field label="备注" style={{ gridColumn: '1 / -1' }}><input value={evForm.note} onChange={e => setEvForm({ ...evForm, note: e.target.value })} /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setEventView(null)}>关闭</Btn>
              <Btn primary onClick={addEvent}>+ 记录事件</Btn>
            </div>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)}>
          <div className="modal">
            <h3>删除员工</h3>
            <p className="hint">确认删除「{confirmDel.name}」？历史工资单记录会保留（工资单表存有快照），但该员工将不再出现在后续算薪与仪表盘中。</p>
            <div className="row">
              <Btn onClick={() => setConfirmDel(null)}>取消</Btn>
              <Btn primary onClick={del}>确认删除</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
