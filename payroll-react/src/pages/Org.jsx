import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field } from '../components/ui.jsx'
import { getDepartments, createDepartment, getOrgOverview } from '../api.js'

export default function Org({ toast, backendUp }) {
  const [data, setData] = useState(null)
  const [overview, setOverview] = useState(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', parent_id: null, head: '', budget_owner: '' })

  const load = async () => {
    try { setData(await getDepartments()); setOverview(await getOrgOverview()) } catch { toast('组织数据加载失败') }
  }
  useEffect(() => { load() }, [backendUp])

  const save = async () => {
    if (!form.name.trim()) return toast('部门名称必填')
    try { await createDepartment(form); toast('已添加部门'); setAdding(false); setForm({ name: '', parent_id: null, head: '', budget_owner: '' }); load() }
    catch { toast('添加失败') }
  }

  const renderNode = (d, depth) => (
    <div key={d.id} style={{ marginLeft: depth * 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: depth === 0 ? '#f1f5f9' : '#fafbfc', borderRadius: 8, margin: '4px 0', fontSize: 13 }}>
        <b>{depth === 0 ? '🏢' : '▸'} {d.name}</b>
        <Chip kind="info">{d.headcount} 人</Chip>
        <span className="hint">{d.head ? '负责人：' + d.head : ''}{d.budget_owner ? ' · 预算责任人：' + d.budget_owner : ''}</span>
      </div>
      {d.children?.map(c => renderNode(c, depth + 1))}
    </div>
  )

  return (
    <>
      <div className="grid g3">
        <Card className="kpi" style={{ margin: 0 }}><div className="label">在职员工</div><div className="num">{overview?.totalActual ?? '—'} 人</div></Card>
        <Card className="kpi" style={{ margin: 0 }}><div className="label">编制计划（年末）</div><div className="num" style={{ color: '#2f54eb' }}>{overview?.totalPlan ?? '—'} 人</div></Card>
        <Card className="kpi" style={{ margin: 0 }}><div className="label">待招缺口</div><div className="num" style={{ color: '#d97706' }}>{((overview?.totalPlan || 0) - (overview?.totalActual || 0))} 人</div></Card>
      </div>

      <Card title={<>组织架构 <Chip kind="info">{data?.list?.length || 0} 个部门</Chip></>} style={{ marginTop: 14 }}>
        <div className="toolbar">
          <Hint>部门树支撑成本归因与预测：员工归属部门 → 成本按部门×类别聚合；预算责任人即审批人</Hint>
          <div style={{ flex: 1 }} />
          <Btn primary onClick={() => setAdding(true)}>+ 添加部门</Btn>
        </div>
        {data?.tree.map(d => renderNode(d, 0))}
        <div style={{ marginTop: 14 }}>
          <Hint>各顶层部门 编制 vs 实际：</Hint>
          <table>
            <tr><th>部门</th><th>实际</th><th>编制（年末）</th><th>缺口</th></tr>
            {overview?.departments.map(d => (
              <tr key={d.id}>
                <td><b>{d.name}</b></td>
                <td>{d.actual}</td>
                <td>{d.planned}</td>
                <td style={{ color: d.planned - d.actual > 0 ? '#d97706' : '#10b981' }}>{d.planned - d.actual > 0 ? '+' + (d.planned - d.actual) : d.planned - d.actual}</td>
              </tr>
            ))}
          </table>
        </div>
      </Card>

      {adding && (
        <div id="modal-bg" className="show" onClick={e => e.target.id === 'modal-bg' && setAdding(false)}>
          <div className="modal">
            <h3>添加部门</h3>
            <div className="grid g2">
              <Field label="部门名称"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="必填" /></Field>
              <Field label="上级部门">
                <select value={form.parent_id || ''} onChange={e => setForm({ ...form, parent_id: e.target.value ? +e.target.value : null })}>
                  <option value="">— 顶层部门 —</option>
                  {data?.list.filter(d => !d.parent_id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="负责人"><input value={form.head} onChange={e => setForm({ ...form, head: e.target.value })} /></Field>
              <Field label="预算责任人"><input value={form.budget_owner} onChange={e => setForm({ ...form, budget_owner: e.target.value })} /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setAdding(false)}>取消</Btn>
              <Btn primary onClick={save}>保存</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
