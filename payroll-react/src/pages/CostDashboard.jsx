import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Kpi } from '../components/ui.jsx'
import Chart from '../components/Chart.jsx'
import { getCostSummary, getCostTrend } from '../api.js'
import { COST_CATEGORY_LABELS } from '../data.js'
import { formatWan } from '../lib/format.js'
import { currentPeriod, periodOptions } from '../lib/period.js'

const CAT_COLORS = { salary: '#2f54eb', social: '#0ea5e9', fund: '#10b981', option: '#8b5cf6', recruiting: '#d97706', other: '#94a3b8' }
export default function CostDashboard({ toast, backendUp, goto }) {
  const [period, setPeriod] = useState(currentPeriod())
  const [s, setS] = useState(null)
  const [trend, setTrend] = useState(null)

  const load = async p => {
    try { setS(await getCostSummary(p)); setTrend(await getCostTrend(6)) } catch { toast('成本数据加载失败') }
  }
  useEffect(() => { load(period) }, [backendUp, period])

  const maxCat = s ? Math.max(1, ...s.categories.map(c => c.amount)) : 1
  const maxDept = s ? Math.max(1, ...s.departments.map(d => d.amount)) : 1

  return (
    <>
      <div className="toolbar">
        <Hint>公司口径薪酬成本：应发工资 + 公司社保 + 公司公积金 + 期权摊销（+ 招聘成本）——区别于员工实发净额</Hint>
        <div style={{ flex: 1 }} />
        <select value={period} onChange={e => setPeriod(e.target.value)}>
          {periodOptions().map(p => <option key={p}>{p}</option>)}
        </select>
      </div>

      <div className="grid g4">
        <Kpi label="公司成本合计" num={s ? formatWan(s.total) : '—'} sub={period} numColor="#dc2626" />
        <Kpi label="环比" num={s ? (s.mom >= 0 ? '+' : '') + s.mom + '%' : '—'} sub="归因见下方" numColor={s?.mom >= 0 ? '#dc2626' : '#10b981'} />
        <Kpi label="人均成本/月" num={s ? '¥' + s.perCapita.toLocaleString('zh-CN') : '—'} sub={`在职 ${s?.headcount || 0} 人`} numColor="#2f54eb" />
        <Kpi label="年化人均" num={s ? formatWan(s.perCapita * 12) : '—'} sub="含公司社保公积金" numColor="#7c3aed" />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="成本构成（按类别）">
          {s && s.categories.filter(c => c.amount > 0).map(c => (
            <div key={c.category} style={{ margin: '8px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 76, fontSize: 12, color: 'var(--muted)' }}>{c.label}</span>
              <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 6, height: 22 }}>
                <div style={{ width: `${c.amount / maxCat * 100}%`, background: CAT_COLORS[c.category], height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', paddingLeft: 8, color: '#fff', fontSize: 11, fontWeight: 600, minWidth: 28 }}>{formatWan(c.amount)}</div>
              </div>
            </div>
          ))}
          <Hint>应发工资含基础+绩效+加班；公司社保 ≈ 缴费基数×26%（养老16+医疗9.5+失业0.5+工伤0.2）；期权摊销来自<a href="#" onClick={e => { e.preventDefault(); goto('equity') }} style={{ color: 'var(--accent)' }}>📜 授予台账</a>（未入台账员工按年度估值估算）</Hint>
        </Card>

        <Card title="成本分布（按部门）">
          {s && s.departments.map(d => (
            <div key={d.department_id} style={{ margin: '8px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 96, fontSize: 12, color: 'var(--muted)' }}>{d.name}</span>
              <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 6, height: 22 }}>
                <div style={{ width: `${d.amount / maxDept * 100}%`, background: '#2f54eb', height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', paddingLeft: 8, color: '#fff', fontSize: 11, fontWeight: 600, minWidth: 28 }}>{formatWan(d.amount)}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <Card title="成本趋势（近 6 个月，万元）" style={{ marginTop: 14 }}>
        {trend ? <Chart data={trend.map(t => ({ label: t.label, value: Math.round(t.total / 10000 * 10) / 10 }))} type="line" color="#dc2626" ySuffix="万" area /> : <Hint>加载中…</Hint>}
      </Card>

      <Card title={<>环比归因 <Chip kind="info">增量 = 新增 + 离职 + 存量变化</Chip></>} style={{ marginTop: 14 }}>
        {s && (
          <div className="grid g4">
            <Kpi label="新增入职" num={formatWan(s.attribution.newHire) + '万'} numColor="#10b981" />
            <Kpi label="离职释放" num={formatWan(s.attribution.departed) + '万'} numColor="#3b82f6" />
            <Kpi label="存量变化" num={formatWan(s.attribution.other) + '万'} numColor="#f59e0b" />
            <Kpi label="净变化" num={formatWan(s.attribution.deltaWan) + '万'} numColor={s.attribution.deltaWan >= 0 ? '#dc2626' : '#10b981'} />
          </div>
        )}
        <Hint style={{ marginTop: 8 }}>新入职和离职员工按精确日期/计薪天数折算；存量变化 = 调薪、绩效、社保基数等变化。</Hint>
      </Card>
    </>
  )
}
