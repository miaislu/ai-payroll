import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field } from '../components/ui.jsx'
import { getEmployees, createEmployee, updateEmployee, deleteEmployee } from '../api.js'
import { DIRECTIONS, CITIES } from '../data.js'

const GRADES = ['P4', 'P5', 'P6', 'M1']
const SUPPORT_FAMILIES = ['财务', '人力资源', '行政', '市场', '法务', '采购', '质量体系']
const MGMT_FAMILIES = ['工程管理', '研发管理', '职能管理']
const JOB_FAMILIES = [...Object.keys(DIRECTIONS), ...SUPPORT_FAMILIES, ...MGMT_FAMILIES]
const CAT_LABEL = { tech: '技术', support: '职能', mgmt: '管理' }
const EMPTY = { name: '', grade: 'P4', job_family: '模拟IC设计', city: '上海', monthly_base: 20000, perf_ratio: 0.3, special_deduction: 0, hire_month: '2025-06' }

export default function Employees({ toast, backendUp }) {
  const [list, setList] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | 员工对象
  const [form, setForm] = useState(EMPTY)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = async () => {
    try { setList(await getEmployees()) } catch { setList([]); toast('员工列表加载失败（后端不可用）') }
  }
  useEffect(() => { load() }, [backendUp])

  const open = mode => { setForm(mode === 'new' ? EMPTY : { ...mode }); setEditing(mode) }
  const set = k => e => setForm({ ...form, [k]: k === 'monthly_base' || k === 'perf_ratio' || k === 'special_deduction' ? +e.target.value : e.target.value })

  const save = async () => {
    if (!form.name.trim()) return toast('姓名必填')
    try {
      if (editing === 'new') { await createEmployee(form); toast('已新增员工') }
      else { await updateEmployee(editing.id, form); toast('已保存修改') }
      setEditing(null)
      load()
    } catch (e) {
      const msg = e.message.includes('400') ? '校验失败：请检查职级/岗位/城市/月薪' : '保存失败'
      toast(msg)
    }
  }
  const del = async () => {
    try { await deleteEmployee(confirmDel.id); toast('已删除 ' + confirmDel.name); setConfirmDel(null); load() }
    catch { toast('删除失败') }
  }

  return (
    <>
      <Card title={<>员工档案 <Chip kind="info">{list?.length || 0} 人</Chip></>}>
        <div className="toolbar">
          <Hint>维护员工档案（姓名/职级/岗位/城市/月薪/专项附加），算薪与仪表盘自动联动</Hint>
          <div style={{ flex: 1 }} />
          <Btn primary onClick={() => open('new')}>+ 新增员工</Btn>
        </div>
        <table>
          <tr><th>姓名</th><th>类别</th><th>职级</th><th>岗位</th><th>城市</th><th>月薪</th><th>入职月</th><th>状态</th><th>操作</th></tr>
          {list?.map(e => (
            <tr key={e.id}>
              <td><b>{e.name}</b></td>
              <td><Chip kind={e.category === 'tech' ? 'info' : e.category === 'support' ? 'gray' : 'warn'}>{CAT_LABEL[e.category] || '技术'}</Chip></td>
              <td>{e.grade}</td><td>{e.job_family}</td><td>{e.city}</td>
              <td>¥{e.monthly_base.toLocaleString('zh-CN')}</td><td>{e.hire_month}</td>
              <td>{e.status === 'departed' ? <Chip kind="warn">离职</Chip> : e.status === 'offer' ? <Chip kind="info">发offer</Chip> : <Chip kind="ok">在职</Chip>}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <Btn sm onClick={() => open(e)}>编辑</Btn>
                <Btn sm onClick={() => setConfirmDel(e)}>删除</Btn>
              </td>
            </tr>
          ))}
          {list && !list.length && <tr><td colSpan={9}><Hint>暂无员工（后端不可用或数据为空）</Hint></td></tr>}
        </table>
      </Card>

      {editing && (
        <div id="modal-bg" className="show" onClick={e => e.target.id === 'modal-bg' && setEditing(null)}>
          <div className="modal" style={{ width: 560 }}>
            <h3>{editing === 'new' ? '新增员工' : '编辑员工 · ' + editing.name}</h3>
            <div className="grid g2">
              <Field label="姓名"><input value={form.name} onChange={set('name')} placeholder="必填" /></Field>
              <Field label="职级"><select value={form.grade} onChange={set('grade')}>{GRADES.map(g => <option key={g}>{g}</option>)}</select></Field>
              <Field label="岗位（技术/职能/管理）"><select value={form.job_family} onChange={set('job_family')}>
                {Object.keys(DIRECTIONS).map(k => <option key={k}>{k}</option>)}
                <optgroup label="职能岗">{SUPPORT_FAMILIES.map(k => <option key={k}>{k}</option>)}</optgroup>
                <optgroup label="管理岗">{MGMT_FAMILIES.map(k => <option key={k}>{k}</option>)}</optgroup>
              </select></Field>
              <Field label="城市"><select value={form.city} onChange={set('city')}>{Object.keys(CITIES).map(k => <option key={k}>{k}</option>)}</select></Field>
              <Field label="月薪（元）"><input type="number" value={form.monthly_base} onChange={set('monthly_base')} min={2000} /></Field>
              <Field label="绩效比例（0-1）"><input type="number" step="0.01" value={form.perf_ratio} onChange={set('perf_ratio')} /></Field>
              <Field label="专项附加扣除/月（元）"><input type="number" value={form.special_deduction} onChange={set('special_deduction')} /></Field>
              <Field label="入职月份"><input type="month" value={form.hire_month} onChange={set('hire_month')} /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setEditing(null)}>取消</Btn>
              <Btn primary onClick={save}>保存</Btn>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div id="modal-bg" className="show" onClick={e => e.target.id === 'modal-bg' && setConfirmDel(null)}>
          <div className="modal">
            <h3>删除员工</h3>
            <p className="hint">确认删除「{confirmDel.name}」？历史工资单记录会保留（工资单表存有快照），但该员工将不再出现在后续算薪与仪表盘中。</p>
            <div className="row">
              <Btn onClick={() => setConfirmDel(null)}>取消</Btn>
              <Btn primary onClick={del}>确认删除</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
