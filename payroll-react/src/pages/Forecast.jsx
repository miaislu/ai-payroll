import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Kpi, Btn, Field } from '../components/ui.jsx'
import Chart from '../components/Chart.jsx'
import { getCostForecast, getCostUnit, getDepartments, getHeadcountPlans, createHeadcountPlan, deleteHeadcountPlan } from '../api.js'

const wan = v => '¥' + (Math.round(v / 10000 * 10) / 10) + '万'

export default function Forecast({ toast, backendUp }) {
  const [data, setData] = useState(null)
  const [unit, setUnit] = useState(null)
  const [plans, setPlans] = useState(null)
  const [depts, setDepts] = useState([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ department_id: null, year_month: '2025-07', planned: 1, note: '' })

  const load = async () => {
    try {
      setData(await getCostForecast(6))
      setUnit(await getCostUnit('2025-06'))
      setPlans(await getHeadcountPlans())
      setDepts((await getDepartments()).list)
    } catch { toast('预测数据加载失败') }
  }
  useEffect(() => { load() }, [backendUp])

  const savePlan = async () => {
    if (!form.department_id || !form.planned) return toast('填写部门与编制数')
    try {
      await createHeadcountPlan({ ...form, planned: +form.planned })
      toast('已保存编制计划')
      setAdding(false)
      setForm({ department_id: null, year_month: '2025-07', planned: 1, note: '' })
      load()
    } catch { toast('保存失败') }
  }
  const delPlan = async p => {
    if (!confirm('删除 ' + p.department + ' ' + p.year_month + ' 的编制记录？')) return
    try { await deleteHeadcountPlan(p.id); toast('已删除'); load() } catch { toast('删除失败') }
  }
  const deptName = id => depts.find(d => d.id === id)?.name || '—'

  const last = data?.series[data.series.length - 1]
  const first = data?.series[0]

  return (
    <>
      <div className="grid g4">
        <Kpi label="当前人均成本/月" num={unit ? '¥' + unit.perCapitaMonthly.toLocaleString('zh-CN') : '—'} sub={unit?.period} numColor="#2f54eb" />
        <Kpi label="年化人均成本" num={unit ? wan(unit.perCapitaAnnual) : '—'} sub="公司口径 · 含社保公积金" numColor="#7c3aed" />
        <Kpi label="社保公积金负担" num={unit ? unit.socialFundBurden + '%' : '—'} sub="占应发工资比（≈26%+7%）" numColor="#d97706" />
        <Kpi label="招聘成本负担" num={unit ? unit.recruitingBurden + '%' : '—'} sub="占公司成本比" numColor="#dc2626" />
      </div>

      <Card title="编制 → 成本预测（未来 6 个月）" style={{ marginTop: 14 }}>
        <div className="toolbar">
          <Hint>预测 = 各部门编制计划 × 部门人均成本（按当前实际成本口径）；编制数据来自 headcount_plan</Hint>
          <div style={{ flex: 1 }} />
          {first && last && <Chip kind="info">{first.period} ¥{Math.round(first.total / 10000 * 10) / 10}万 → {last.period} ¥{Math.round(last.total / 10000 * 10) / 10}万</Chip>}
        </div>
        {data ? (
          <>
            <Chart data={data.series.map(s => ({ label: s.label, value: Math.round(s.total / 10000 * 10) / 10 }))} type="line" color="#7c3aed" ySuffix="万" area />
            <Hint style={{ marginTop: 6 }}>编制 = 手动编制计划 + 🎯 进行中招聘需求（按预计到岗月自动计入）；需求关闭/取消自动移除</Hint>
            <div style={{ marginTop: 12 }}>
              <table>
                <tr><th>月份</th><th>预测成本</th><th>编制人数</th><th>手动编制</th><th>招聘需求</th><th>当前人数</th><th>各部门明细</th></tr>
                {data.series.map(s => (
                  <tr key={s.period}>
                    <td><b>{s.period}</b></td>
                    <td style={{ fontWeight: 600 }}>{wan(s.total)}</td>
                    <td>{s.planned} 人</td>
                    <td>{s.plannedManual || 0}</td>
                    <td>{s.plannedRequisition ? <span style={{ color: '#d97706', fontWeight: 600 }}>+{s.plannedRequisition}</span> : 0}</td>
                    <td>{s.currentPlanned} 人</td>
                    <td className="hint">{s.detail.map(d => `${d.name} ${d.count}人${d.source === 'requisition' ? '🎯' : d.source === 'both' ? '(含🎯)' : ''}`).join(' · ')}</td>
                  </tr>
                ))}
              </table>
            </div>
          </>
        ) : <Hint>加载中…</Hint>}
      </Card>

      <Card title="单位经济指标" style={{ marginTop: 14 }}>
        {unit && (
          <div className="grid g4">
            <Kpi label="人均月成本" num={'¥' + unit.perCapitaMonthly.toLocaleString('zh-CN')} />
            <Kpi label="应发工资占比" num={unit.laborCostRatio + '%'} sub="应发 ÷ 公司总成本" />
            <Kpi label="社保公积金负担" num={unit.socialFundBurden + '%'} sub="公司侧 ÷ 应发工资" />
            <Kpi label="招聘成本占比" num={unit.recruitingBurden + '%'} sub="渠道费用 ÷ 公司成本" />
          </div>
        )}
        <Hint style={{ marginTop: 8 }}>{unit?.note}。半导体初创场景参考：模拟/数字设计岗公司口径成本约为月薪的 1.4 倍（26%+7% 社保公积金 + 期权摊销）。</Hint>
      </Card>

      <Card title={<>编制计划管理 <Chip kind="info">{plans?.length || 0} 条</Chip></>} style={{ marginTop: 14 }}>
        <div className="toolbar">
          <Hint>编制计划是成本预测的数据源：部门 × 月份 × 编制人数；同部门同月重复保存会覆盖</Hint>
          <div style={{ flex: 1 }} />
          <Btn primary onClick={() => setAdding(true)}>+ 新增编制</Btn>
        </div>
        <table>
          <tr><th>部门</th><th>月份</th><th>编制人数</th><th>备注</th><th>操作</th></tr>
          {plans?.map(p => (
            <tr key={p.id}>
              <td><b>{p.department}</b></td>
              <td>{p.year_month}</td>
              <td>{p.planned} 人</td>
              <td className="hint">{p.note || '—'}</td>
              <td><Btn sm onClick={() => delPlan(p)}>删除</Btn></td>
            </tr>
          ))}
          {plans && !plans.length && <tr><td colSpan={5}><Hint>暂无编制计划，新增后成本预测立即联动</Hint></td></tr>}
        </table>
      </Card>

      {adding && (
        <div id="modal-bg" className="show" onClick={e => e.target.id === 'modal-bg' && setAdding(false)}>
          <div className="modal">
            <h3>新增编制计划</h3>
            <div className="grid g2">
              <Field label="部门">
                <select value={form.department_id || ''} onChange={e => setForm({ ...form, department_id: e.target.value ? +e.target.value : null })}>
                  <option value="">— 选择部门 —</option>
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="月份"><input type="month" value={form.year_month} onChange={e => setForm({ ...form, year_month: e.target.value })} /></Field>
              <Field label="编制人数"><input type="number" value={form.planned} onChange={e => setForm({ ...form, planned: e.target.value })} min={0} /></Field>
              <Field label="备注"><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setAdding(false)}>取消</Btn>
              <Btn primary onClick={savePlan}>保存</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
