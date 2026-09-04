import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getEmployees, createEmployee, updateEmployee, deleteEmployee, getDepartments, getEmployeeEvents, createEmployeeEvent, deleteEmployeeEvent } from '../api.js'
import { DIRECTIONS, CITIES } from '../data.js'
import { currentDate, currentPeriod } from '../lib/period.js'

const GRADES = ['P4', 'P5', 'P6', 'P7', 'M1', 'M2']
const SUPPORT_FAMILIES = ['财务', '人力资源', '行政', '市场', '法务', '采购', '质量体系']
const MGMT_FAMILIES = ['工程管理', '研发管理', '职能管理']
const JOB_FAMILIES = [...Object.keys(DIRECTIONS), ...SUPPORT_FAMILIES, ...MGMT_FAMILIES]
const CAT_LABEL = { tech: '技术', support: '职能', mgmt: '管理' }
const ETYPE_LABEL = { employee: '正式', consultant: '顾问', intern: '实习生' }
const EVENT_TYPES = [
  { key: 'onboard', label: '入职' }, { key: 'regularize', label: '转正' },
  { key: 'promotion', label: '晋升' }, { key: 'transfer', label: '调动' },
  { key: 'offboard', label: '离职' }
]
const emptyEmployee = () => ({ name: '', grade: 'P4', job_family: '模拟IC设计', city: '上海', monthly_base: 20000, perf_ratio: 0.3, special_deduction: 0, hire_date: currentDate(), hire_month: currentPeriod(), leave_date: '', leave_month: '', effective_month: currentPeriod(), severance_amount: 0, department_id: null, category: 'tech', status: 'active', employment_type: 'employee', supplemental_fund_rate: 0 })
const EV_EMPTY = { type: 'onboard', event_date: '', from_value: '', to_value: '', note: '' }

export default function Employees({ toast, backendUp, openProfile }) {
  const [list, setList] = useState(null)
  const [depts, setDepts] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyEmployee)
  const [confirmDel, setConfirmDel] = useState(null)
  const [eventView, setEventView] = useState(null) // 员工事件面板
  const [events, setEvents] = useState([])
  const [evForm, setEvForm] = useState(EV_EMPTY)

  const load = async () => {
    try { setList(await getEmployees()); setDepts((await getDepartments()).list) } catch { setList([]); toast('员工列表加载失败（后端不可用）') }
  }
  useEffect(() => { load() }, [backendUp])

  const open = mode => {
    const value = mode === 'new'
      ? emptyEmployee()
      : {
          ...mode,
          department_id: mode.department_id || null,
          hire_date: mode.hire_date || `${mode.hire_month}-01`,
          leave_date: mode.leave_date || '',
          effective_month: currentPeriod()
        }
    setForm(value)
    setEditing(mode)
  }
  const set = k => e => setForm({ ...form, [k]: ['monthly_base', 'perf_ratio', 'special_deduction', 'department_id', 'supplemental_fund_rate', 'severance_amount'].includes(k) ? (e.target.value === '' ? null : +e.target.value) : e.target.value })

  const save = async () => {
    if (!form.name.trim()) return toast('姓名必填')
    try {
      if (editing === 'new') { await createEmployee(form); toast('已新增员工') }
      else { await updateEmployee(editing.id, form); toast('已保存修改') }
      setEditing(null); load()
    } catch (e) {
      toast(e.message.includes('400') ? '校验失败：请检查职级/岗位/城市/月薪' : '保存失败')
    }
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
    if (!confirm('删除该事件？')) return
    try { await deleteEmployeeEvent(id); setEvents(await getEmployeeEvents(eventView.id)) } catch { toast('删除失败') }
  }

  const deptName = id => depts.find(d => d.id === id)?.name || '—'
  const eventLabel = k => EVENT_TYPES.find(t => t.key === k)?.label || k

  return (
    <>
      <Card title={<>员工档案 <Chip kind="info">{list?.length || 0} 人</Chip></>}>
        <div className="toolbar">
          <Hint>员工档案（姓名/职级/岗位/城市/月薪/部门/专项附加）→ 算薪与成本归因自动联动</Hint>
          <div style={{ flex: 1 }} />
          <Btn primary onClick={() => open('new')}>+ 新增员工</Btn>
        </div>
        <table>
          <tr><th>姓名</th><th>类别</th><th>用工</th><th>职级</th><th>岗位</th><th>部门</th><th>性别</th><th>城市</th><th>月薪</th><th>手机</th><th>状态</th><th>操作</th></tr>
          {list?.map(e => (
            <tr key={e.id}>
              <td><b>{e.name}</b></td>
              <td><Chip kind={e.category === 'tech' ? 'info' : e.category === 'support' ? 'gray' : 'warn'}>{CAT_LABEL[e.category] || '技术'}</Chip></td>
              <td>{e.employment_type === 'consultant' ? <Chip kind="warn">顾问</Chip> : e.employment_type === 'intern' ? <Chip kind="info">实习生</Chip> : <Chip kind="ok">正式</Chip>}</td>
              <td>{e.grade}</td><td>{e.job_family}</td>
              <td>{deptName(e.department_id)}</td><td>{e.gender || '—'}</td><td>{e.city}</td>
              <td>¥{e.monthly_base.toLocaleString('zh-CN')}</td>
              <td className="hint">{e.mobile || '—'}</td>
              <td>{e.status === 'departed' ? <Chip kind="warn">离职</Chip> : e.status === 'offer' ? <Chip kind="info">发offer</Chip> : <Chip kind="ok">在职</Chip>}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <Btn sm onClick={() => openProfile(e.id)}>档案</Btn>
                <Btn sm onClick={() => open(e)}>编辑</Btn>
                <Btn sm onClick={() => openEvents(e)}>事件</Btn>
                <Btn sm onClick={() => setConfirmDel(e)}>删除</Btn>
              </td>
            </tr>
          ))}
          {list && !list.length && <tr><td colSpan={12}><Hint>暂无员工（后端不可用或数据为空）</Hint></td></tr>}
        </table>
      </Card>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div className="modal" style={{ width: 620 }}>
            <h3>{editing === 'new' ? '新增员工' : '编辑员工 · ' + editing.name}</h3>
            <div className="grid g2">
              <Field label="姓名"><input value={form.name} onChange={set('name')} placeholder="必填" /></Field>
              <Field label="职级"><select value={form.grade} onChange={set('grade')}>{GRADES.map(g => <option key={g}>{g}</option>)}</select></Field>
              <Field label="岗位（技术/职能/管理）"><select value={form.job_family} onChange={set('job_family')}>
                {Object.keys(DIRECTIONS).map(k => <option key={k}>{k}</option>)}
                <optgroup label="职能岗">{SUPPORT_FAMILIES.map(k => <option key={k}>{k}</option>)}</optgroup>
                <optgroup label="管理岗">{MGMT_FAMILIES.map(k => <option key={k}>{k}</option>)}</optgroup>
              </select></Field>
              <Field label="部门">
                <select value={form.department_id || ''} onChange={set('department_id')}>
                  <option value="">— 未分配 —</option>
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="城市"><select value={form.city} onChange={set('city')}>{Object.keys(CITIES).map(k => <option key={k}>{k}</option>)}</select></Field>
              <Field label="类别">
                <select value={form.category} onChange={set('category')}>
                  <option value="tech">技术</option><option value="support">职能</option><option value="mgmt">管理</option>
                </select>
              </Field>
              <Field label="用工类型">
                <select value={form.employment_type || 'employee'} onChange={set('employment_type')}>
                  <option value="employee">正式员工</option>
                  <option value="consultant">顾问（劳务报酬）</option>
                  <option value="intern">实习生</option>
                </select>
              </Field>
              <Field label="月薪（元）"><input type="number" value={form.monthly_base} onChange={set('monthly_base')} min={2000} /></Field>
              <Field label="绩效比例（0-1）"><input type="number" step="0.01" value={form.perf_ratio} onChange={set('perf_ratio')} /></Field>
              <Field label="专项附加扣除/月（元）"><input type="number" value={form.special_deduction} onChange={set('special_deduction')} /></Field>
              <Field label="补充公积金比例（0-0.08）"><input type="number" step="0.01" min="0" max="0.08" value={form.supplemental_fund_rate ?? 0} onChange={set('supplemental_fund_rate')} /></Field>
              <Field label="入职日期"><input type="date" value={form.hire_date || ''} onChange={set('hire_date')} /></Field>
              {editing !== 'new' && <Field label="薪酬变更生效月份"><input type="month" value={form.effective_month || currentPeriod()} onChange={set('effective_month')} /></Field>}
              <Field label="状态"><select value={form.status || 'active'} onChange={set('status')}><option value="active">在职</option><option value="offer">待入职</option><option value="departed">离职</option></select></Field>
              {form.status === 'departed' && <Field label="离职日期"><input type="date" value={form.leave_date || ''} onChange={set('leave_date')} /></Field>}
              {form.status === 'departed' && <Field label="离职补偿（显式金额）"><input type="number" min="0" value={form.severance_amount || 0} onChange={set('severance_amount')} /></Field>}
            </div>
            <div className="row">
              <Btn onClick={() => setEditing(null)}>取消</Btn>
              <Btn primary onClick={save}>保存</Btn>
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
