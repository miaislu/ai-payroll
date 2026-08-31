import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field } from '../components/ui.jsx'
import { getCostBudget, getDepartments, createBudget } from '../api.js'
import { COST_CATEGORY_LABELS } from '../data.js'

const wan = v => '¥' + (Math.round(v / 10000 * 10) / 10) + '万'
const PERIODS = ['2025-05', '2025-06', '2025-07']
const CATS = ['salary', 'social', 'fund', 'option', 'recruiting', 'other']

export default function Budget({ toast, backendUp }) {
  const [period, setPeriod] = useState('2025-06')
  const [data, setData] = useState(null)
  const [depts, setDepts] = useState([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ year_month: '2025-06', department_id: null, category: 'salary', amount: '', note: '' })

  const load = async p => {
    try { setData(await getCostBudget(p)); setDepts((await getDepartments()).list) } catch { toast('预算数据加载失败') }
  }
  useEffect(() => { load(period) }, [backendUp, period])

  const saveBudget = async () => {
    if (!form.amount) return toast('填写预算金额')
    try {
      await createBudget({ ...form, amount: +form.amount })
      toast('已新增预算')
      setAdding(false)
      setForm({ year_month: period, department_id: null, category: 'salary', amount: '', note: '' })
      load(period)
    } catch { toast('保存失败') }
  }

  const cell = (v, kind) => {
    if (v === undefined || v === null) return <span className="hint">—</span>
    const over = v < 0
    return <span style={{ color: over ? '#dc2626' : 'inherit', fontWeight: over ? 600 : 400 }}>{wan(v)}</span>
  }
  const diff = (a, b) => a - b
  const deptName = id => depts.find(d => d.id === id)?.name || '未分配'

  return (
    <>
      <Card title={<>预算 vs 实际 <Chip kind="info">{period}</Chip></>}>
        <div className="toolbar">
          <Hint>预算按 部门 × 成本类别 维护（cost_budgets 表）；实际 = 公司口径成本聚合 + 渠道费用（招聘成本）</Hint>
          <div style={{ flex: 1 }} />
          <select value={period} onChange={e => setPeriod(e.target.value)}>
            {PERIODS.map(p => <option key={p}>{p}</option>)}
          </select>
          <Btn primary onClick={() => { setForm({ year_month: period, department_id: null, category: 'salary', amount: '', note: '' }); setAdding(true) }}>+ 新增预算</Btn>
        </div>

        <table>
          <tr>
            <th rowSpan={2}>部门</th>
            <th colSpan={3}>应发工资</th>
            <th colSpan={3}>公司社保</th>
            <th colSpan={3}>公司公积金</th>
            <th colSpan={3}>招聘成本</th>
            <th rowSpan={2}>合计差额</th>
          </tr>
          <tr>
            {[...Array(4)].map((_, i) => (
              <span key={i} style={{ display: 'contents' }}>
                <th>预算</th><th>实际</th><th>差</th>
              </span>
            ))}
          </tr>
          {data?.rows.map(r => {
            const b = r.budget || {}
            const a = r.actual || {}
            return (
              <tr key={r.key}>
                <td><b>{r.name}</b></td>
                {cell(b.salary)} {cell(a.salary)} {cell(diff(a.salary || 0, b.salary || 0))}
                {cell(b.social)} {cell(a.social)} {cell(diff(a.social || 0, b.social || 0))}
                {cell(b.fund)} {cell(a.fund)} {cell(diff(a.fund || 0, b.fund || 0))}
                {cell(b.recruiting)} {cell(a.recruiting)} {cell(diff(a.recruiting || 0, b.recruiting || 0))}
                <td>{cell(diff((a.salary || 0) + (a.social || 0) + (a.fund || 0) + (a.recruiting || 0), (b.salary || 0) + (b.social || 0) + (b.fund || 0) + (b.recruiting || 0)))}</td>
              </tr>
            )
          })}
          {data && (
            <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
              <td>合计</td>
              <td>{cell(data.totals.budget.salary)}</td><td>{cell(data.totals.actual.salary)}</td><td>{cell(diff(data.totals.actual.salary || 0, data.totals.budget.salary || 0))}</td>
              <td>{cell(data.totals.budget.social)}</td><td>{cell(data.totals.actual.social)}</td><td>{cell(diff(data.totals.actual.social || 0, data.totals.budget.social || 0))}</td>
              <td>{cell(data.totals.budget.fund)}</td><td>{cell(data.totals.actual.fund)}</td><td>{cell(diff(data.totals.actual.fund || 0, data.totals.budget.fund || 0))}</td>
              <td>{cell(data.totals.budget.recruiting)}</td><td>{cell(data.totals.actual.recruiting)}</td><td>{cell(diff(data.totals.actual.recruiting || 0, data.totals.budget.recruiting || 0))}</td>
              <td>{cell(diff((data.totals.actual.salary || 0) + (data.totals.actual.social || 0) + (data.totals.actual.fund || 0) + (data.totals.actual.recruiting || 0), (data.totals.budget.salary || 0) + (data.totals.budget.social || 0) + (data.totals.budget.fund || 0) + (data.totals.budget.recruiting || 0)))}</td>
            </tr>
          )}
        </table>
        <Hint style={{ marginTop: 8 }}>负值（红色）= 超预算。期权摊销与「其他」类暂未计入本表口径。</Hint>
      </Card>

      {adding && (
        <div id="modal-bg" className="show" onClick={e => e.target.id === 'modal-bg' && setAdding(false)}>
          <div className="modal">
            <h3>新增预算（{form.year_month}）</h3>
            <div className="grid g2">
              <Field label="月份"><input type="month" value={form.year_month} onChange={e => setForm({ ...form, year_month: e.target.value })} /></Field>
              <Field label="部门">
                <select value={form.department_id || ''} onChange={e => setForm({ ...form, department_id: e.target.value ? +e.target.value : null })}>
                  <option value="">招聘（全公司）</option>
                  {depts.filter(d => !d.parent_id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="成本类别">
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {Object.entries(COST_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="金额（元）"><input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="备注" style={{ gridColumn: '1 / -1' }}><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setAdding(false)}>取消</Btn>
              <Btn primary onClick={saveBudget}>保存</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
