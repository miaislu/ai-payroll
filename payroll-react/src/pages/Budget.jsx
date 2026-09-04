import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getCostBudget, getDepartments, createBudget } from '../api.js'
import { COST_CATEGORY_LABELS } from '../data.js'
import { formatWan } from '../lib/format.js'
import { currentPeriod, periodOptions } from '../lib/period.js'

const CATS = ['salary', 'social', 'fund', 'option', 'recruiting', 'other']

export default function Budget({ toast, backendUp }) {
  const [period, setPeriod] = useState(currentPeriod())
  const [data, setData] = useState(null)
  const [depts, setDepts] = useState([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ year_month: currentPeriod(), department_id: null, category: 'salary', amount: '', note: '' })

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

  const cell = (v) => {
    if (v === undefined || v === null) return <td className="hint">—</td>
    const over = v > 0
    return <td style={{ color: over ? '#dc2626' : 'inherit', fontWeight: over ? 600 : 400 }}>{formatWan(v)}</td>
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
            {periodOptions().map(p => <option key={p}>{p}</option>)}
          </select>
          <Btn primary onClick={() => { setForm({ year_month: period, department_id: null, category: 'salary', amount: '', note: '' }); setAdding(true) }}>+ 新增预算</Btn>
        </div>

        <table>
          <thead>
            <tr>
              <th rowSpan={2}>部门</th>
              <th colSpan={3}>应发工资</th>
              <th colSpan={3}>公司社保</th>
              <th colSpan={3}>公司公积金</th>
              <th colSpan={3}>招聘成本</th>
              <th rowSpan={2}>合计差额</th>
            </tr>
            <tr>
              {['应发', '社保', '公积金', '招聘'].flatMap(k => [
                <th key={k + 'b'}>预算</th>,
                <th key={k + 'a'}>实际</th>,
                <th key={k + 'd'}>差</th>
              ])}
            </tr>
          </thead>
          <tbody>
          {data?.rows.map(r => {
            const b = r.budget || {}
            const a = r.actual || {}
            return (
              <tr key={r.key}>
                <td><b>{r.name}</b></td>
                {cell(b.salary)}{cell(a.salary)}{cell(diff(a.salary || 0, b.salary || 0))}
                {cell(b.social)}{cell(a.social)}{cell(diff(a.social || 0, b.social || 0))}
                {cell(b.fund)}{cell(a.fund)}{cell(diff(a.fund || 0, b.fund || 0))}
                {cell(b.recruiting)}{cell(a.recruiting)}{cell(diff(a.recruiting || 0, b.recruiting || 0))}
                {cell(diff((a.salary || 0) + (a.social || 0) + (a.fund || 0) + (a.recruiting || 0), (b.salary || 0) + (b.social || 0) + (b.fund || 0) + (b.recruiting || 0)))}
              </tr>
            )
          })}
          {data && (
            <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
              <td>合计</td>
              {cell(data.totals.budget.salary)}{cell(data.totals.actual.salary)}{cell(diff(data.totals.actual.salary || 0, data.totals.budget.salary || 0))}
              {cell(data.totals.budget.social)}{cell(data.totals.actual.social)}{cell(diff(data.totals.actual.social || 0, data.totals.budget.social || 0))}
              {cell(data.totals.budget.fund)}{cell(data.totals.actual.fund)}{cell(diff(data.totals.actual.fund || 0, data.totals.budget.fund || 0))}
              {cell(data.totals.budget.recruiting)}{cell(data.totals.actual.recruiting)}{cell(diff(data.totals.actual.recruiting || 0, data.totals.budget.recruiting || 0))}
              {cell(diff((data.totals.actual.salary || 0) + (data.totals.actual.social || 0) + (data.totals.actual.fund || 0) + (data.totals.actual.recruiting || 0), (data.totals.budget.salary || 0) + (data.totals.budget.social || 0) + (data.totals.budget.fund || 0) + (data.totals.budget.recruiting || 0)))}
            </tr>
          )}
          </tbody>
        </table>
        <Hint style={{ marginTop: 8 }}>差额 = 实际 - 预算；正值（红色）表示超预算。期权摊销与「其他」类暂未计入本表口径。</Hint>
      </Card>

      {adding && (
        <Modal onClose={() => setAdding(false)}>
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
        </Modal>
      )}
    </>
  )
}
