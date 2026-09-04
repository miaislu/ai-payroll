import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getRequisitions, createRequisition, updateRequisition, deleteRequisition, getDepartments } from '../api.js'
import { REQUISITION_STATUS, DIRECTIONS } from '../data.js'
import { addMonths, currentPeriod } from '../lib/period.js'

const EMPTY = { title: '', department_id: null, job_family: '模拟IC设计', grade: 'P5', city: '上海', headcount: 1, priority: 'normal', status: 'open', salary_min: 30000, salary_max: 50000, reason: '', target_month: addMonths(currentPeriod(), 2) }
const statusKind = k => ({ open: 'ok', interview: 'info', draft: 'gray', closed: 'gray', cancelled: 'warn' }[k] || 'gray')
const statusLabel = k => REQUISITION_STATUS.find(s => s.key === k)?.label || k

export default function Requisitions({ toast, backendUp }) {
  const [list, setList] = useState(null)
  const [depts, setDepts] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)

  const load = async () => {
    try { setList(await getRequisitions()); setDepts((await getDepartments()).list) } catch { toast('招聘需求加载失败') }
  }
  useEffect(() => { load() }, [backendUp])

  const open = m => { setForm(m === 'new' ? EMPTY : { ...m }); setEditing(m) }
  const set = k => e => setForm({ ...form, [k]: ['department_id', 'headcount', 'salary_min', 'salary_max'].includes(k) ? (e.target.value === '' ? null : +e.target.value) : e.target.value })

  const save = async () => {
    if (!form.title.trim()) return toast('岗位名称必填')
    try {
      if (editing === 'new') { await createRequisition(form); toast('已创建招聘需求') }
      else { await updateRequisition(editing.id, form); toast('已保存') }
      setEditing(null); load()
    } catch { toast('保存失败') }
  }
  const del = async r => {
    if (!confirm('确认删除需求「' + r.title + '」？关联候选人保留')) return
    try { await deleteRequisition(r.id); toast('已删除'); load() } catch { toast('删除失败') }
  }

  return (
    <>
      <Card title={<>招聘需求 <Chip kind="info">{list?.length || 0} 个</Chip></>}>
        <div className="toolbar">
          <Hint>需求 = 编制 + 预算区间 + 状态；候选人关联需求后自动聚合「已入职/进行中」</Hint>
          <div style={{ flex: 1 }} />
          <Btn primary onClick={() => open('new')}>+ 新建需求</Btn>
        </div>
        <table>
          <tr><th>岗位</th><th>部门</th><th>职级</th><th>城市</th><th>编制</th><th>预计到岗</th><th>进度</th><th>预算区间/月</th><th>状态</th><th>操作</th></tr>
          {list?.map(r => (
            <tr key={r.id}>
              <td><b>{r.title}</b>{r.priority === 'high' && <Chip kind="warn">高优</Chip>}</td>
              <td>{r.department}</td>
              <td>{r.grade}</td>
              <td>{r.city}</td>
              <td>{r.headcount}</td>
              <td>{r.target_month || '—'}</td>
              <td>{r.filled} 入职 / {r.active_candidates} 进行中</td>
              <td>{r.salary_min ? '¥' + r.salary_min.toLocaleString('zh-CN') + ' ~ ' + r.salary_max.toLocaleString('zh-CN') : '—'}</td>
              <td><Chip kind={statusKind(r.status)}>{statusLabel(r.status)}</Chip></td>
              <td style={{ display: 'flex', gap: 6 }}>
                <Btn sm onClick={() => open(r)}>编辑</Btn>
                <Btn sm onClick={() => del(r)}>删除</Btn>
              </td>
            </tr>
          ))}
          {list && !list.length && <tr><td colSpan={10}><Hint>暂无招聘需求</Hint></td></tr>}
        </table>
      </Card>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div className="modal" style={{ width: 580 }}>
            <h3>{editing === 'new' ? '新建招聘需求' : '编辑需求 · ' + editing.title}</h3>
            <div className="grid g2">
              <Field label="岗位名称"><input value={form.title} onChange={set('title')} placeholder="如：数字前端(RTL)工程师" /></Field>
              <Field label="部门">
                <select value={form.department_id || ''} onChange={e => setForm({ ...form, department_id: e.target.value ? +e.target.value : null })}>
                  <option value="">— 未分配 —</option>
                  {depts.filter(d => !d.parent_id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="岗位族">
                <select value={form.job_family} onChange={set('job_family')}>
                  {Object.keys(DIRECTIONS).map(k => <option key={k}>{k}</option>)}
                  <optgroup label="职能/管理">{['财务', '人力资源', '行政', '销售', '市场', '工程管理'].map(k => <option key={k}>{k}</option>)}</optgroup>
                </select>
              </Field>
              <Field label="职级">
                <select value={form.grade} onChange={set('grade')}>{['P4', 'P5', 'P6', 'P7', 'M1', 'M2'].map(g => <option key={g}>{g}</option>)}</select>
              </Field>
              <Field label="城市"><input value={form.city} onChange={set('city')} /></Field>
              <Field label="编制人数"><input type="number" value={form.headcount} onChange={set('headcount')} min={1} /></Field>
              <Field label="预计到岗月（联动成本预测）"><input type="month" value={form.target_month || ''} onChange={set('target_month')} /></Field>
              <Field label="月薪下限"><input type="number" value={form.salary_min} onChange={set('salary_min')} /></Field>
              <Field label="月薪上限"><input type="number" value={form.salary_max} onChange={set('salary_max')} /></Field>
              <Field label="优先级">
                <select value={form.priority} onChange={set('priority')}>
                  <option value="normal">普通</option><option value="high">高优</option><option value="urgent">紧急</option>
                </select>
              </Field>
              <Field label="状态">
                <select value={form.status} onChange={set('status')}>
                  {REQUISITION_STATUS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="招聘原因" style={{ gridColumn: '1 / -1' }}><input value={form.reason} onChange={set('reason')} placeholder="业务背景 / 到岗要求" /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setEditing(null)}>取消</Btn>
              <Btn primary onClick={save}>保存</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
