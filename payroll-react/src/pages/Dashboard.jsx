import { useEffect, useState } from 'react'
import Chart from '../components/Chart.jsx'
import { Card, Chip, Hint, Btn } from '../components/ui.jsx'
import { api } from '../api.js'

const FALLBACK = {
  summary: { period: '2025-06', total: 400925, prev: 354275, mom: 13.2, headcount: 13, penetration: 0,
    people: { headcount: 13, pendingHires: 2, pendingLeavers: 1, offers: 2, byCategory: [{ category: 'tech', c: 9 }, { category: 'support', c: 3 }, { category: 'mgmt', c: 1 }] },
    attribution: { newHire: 0, severance: 68.3, socialAdj: 0, other: 0, deltaWan: 46.7 } },
  trend: [
    { period: '2025-01', label: '1月', value: 9.2, count: 4 }, { period: '2025-02', label: '2月', value: 18.6, count: 7 },
    { period: '2025-03', label: '3月', value: 25.6, count: 10 }, { period: '2025-04', label: '4月', value: 29.4, count: 11 },
    { period: '2025-05', label: '5月', value: 32.2, count: 12 }, { period: '2025-06', label: '6月', value: 40.1, count: 14 }
  ],
  distAll: { data: [{ label: 'P4', value: 19.2 }, { label: 'P5', value: 34.5 }, { label: 'M1', value: 55 }], refP50: 50, count: 13 },
  attrition: [], forecast: { target: 60, currentHeadcount: 13, monthlyCostWan: 185, note: '线性外推' }
}
const CATEGORIES = [['all', '全部'], ['tech', '技术'], ['support', '职能'], ['mgmt', '管理']]

export default function Dashboard({ goto, backendUp, user }) {
  const role = user?.role || 'founder'
  const [d, setD] = useState(null)
  const [cat, setCat] = useState('all')
  const [empView, setEmpView] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [summary, trend, distAll, attrition, forecast] = await Promise.all([
          api('/dashboard/summary?period=2025-06'), api('/dashboard/trend?months=6'),
          api('/dashboard/distribution?category=all'), api('/dashboard/attrition'), api('/dashboard/forecast?target=60')
        ])
        if (alive) setD({ summary, trend, distAll, dist: distAll, attrition, forecast })
      } catch { if (alive) setD(FALLBACK) }
    })()
    return () => { alive = false }
  }, [backendUp])

  // 类别 tab：切换时拉取对应分布
  useEffect(() => {
    let alive = true
    if (!backendUp) return
    api('/dashboard/distribution?category=' + cat).then(r => alive && setD(prev => prev && { ...prev, dist: r })).catch(() => {})
    return () => { alive = false }
  }, [cat, backendUp])

  // 员工视角：个人薪酬概览
  useEffect(() => {
    let alive = true
    if (role === 'emp' && backendUp) api('/payslip/me').then(r => alive && setEmpView(r)).catch(() => {})
    return () => { alive = false }
  }, [role, backendUp])

  if (!d) return <Card><Hint>仪表盘加载中…</Hint></Card>
  const { summary, trend } = d
  const dist = d.dist || d.distAll
  const people = summary.people || { headcount: summary.headcount, pendingHires: 0, pendingLeavers: 0, offers: 0, byCategory: [] }
  const catCount = c => people.byCategory?.find(x => x.category === c)?.c ?? '-'
  const trendData = trend.map(t => ({ label: t.label, value: t.value }))
  const distData = dist.data.map((x, i) => ({ ...x, color: ['#38bdf8', '#93b4fd', '#0ea5e9', '#2f54eb'][i % 4] }))

  // ── 员工视角：个人总览 ──
  if (role === 'emp') {
    const tax = empView?.items?.find(i => i.label.includes('个税'))?.value
    return (
      <>
        <div className="grid g4">
          <div className="card kpi"><div className="label">本月实发</div><div className="num" style={{ fontSize: 22 }}>¥{empView?.net || '—'}</div><div className="sub flat">2025-06</div></div>
          <div className="card kpi"><div className="label">本月个税</div><div className="num" style={{ fontSize: 19 }}>{tax || '—'}</div><div className="sub flat">累计预扣法</div></div>
          <div className="card kpi"><div className="label">期权已归属</div><div className="num" style={{ fontSize: 19 }}>{empView?.option?.vested || '25%'}</div><div className="sub flat">{empView?.option?.est_value || ''}</div></div>
          <div className="card kpi"><div className="label">薪酬状态</div><div className="num" style={{ fontSize: 19, color: 'var(--ok)' }}>✓ 已发放</div><div className="sub flat">有问题可申诉</div></div>
        </div>
        <div className="grid g2">
          <Card title="我的薪酬单"><Btn sm onClick={() => goto('payslip')}>查看完整薪酬单 →</Btn></Card>
          <Card title="有薪酬问题？"><Btn sm onClick={() => goto('copilot')}>问 AI 助手 →</Btn></Card>
        </div>
      </>
    )
  }

  const momCls = summary.mom > 0 ? 'up' : 'down'
  const attrs = [
    { label: '新招聘', v: summary.attribution.newHire },
    { label: '离职结算', v: summary.attribution.severance },
    { label: '社保基数调整', v: summary.attribution.socialAdj },
    { label: '其他', v: summary.attribution.other }
  ].filter(a => Math.abs(a.v) > 0.05)

  return (
    <>
      {role === 'founder' ? (
        <div className="grid g4">
          <div className="card kpi"><div className="label">员工总数</div><div className="num">{people.headcount}</div><div className="sub flat">技术 {catCount('tech')} · 职能 {catCount('support')} · 管理 {catCount('mgmt')}</div></div>
          <div className="card kpi"><div className="label">待入职</div><div className="num">{people.pendingHires}</div><div className="sub warn">已确认 7-8 月到岗</div></div>
          <div className="card kpi"><div className="label">待离职</div><div className="num">{people.pendingLeavers}</div><div className="sub warn">已提计划</div></div>
          <div className="card kpi"><div className="label">发 offer</div><div className="num">{people.offers}</div><div className="sub ok">待确认入职</div></div>
        </div>
      ) : (
        <div className="grid g4">
          <div className="card kpi"><div className="label">本月算薪</div><div className="num" style={{ fontSize: 17, paddingTop: 6 }}><Chip kind="ok">✓ 已发放</Chip></div><div className="sub flat">14 人 · 复核 1.5h</div></div>
          <div className="card kpi"><div className="label">待审批</div><div className="num">4</div><div className="sub warn">带宽×1 · 调薪×2 · 期权×1</div></div>
          <div className="card kpi"><div className="label">员工总数</div><div className="num">{people.headcount}</div><div className="sub flat">技术 {catCount('tech')} / 职能 {catCount('support')} / 管理 {catCount('mgmt')}</div></div>
          <div className="card kpi"><div className="label">本月薪酬成本</div><div className="num" style={{ fontSize: 20 }}>¥{summary.total.toLocaleString('zh-CN')}</div><div className={`sub ${momCls}`}>环比 {summary.mom > 0 ? '+' : ''}{summary.mom}%</div></div>
        </div>
      )}

      <Card title="⭐ 重点模块快捷入口" style={{ marginTop: 14 }}>
        <div className="grid g4">
          <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #2f54eb' }} onClick={() => goto('recruiting')}>
            <div className="label">🎯 招聘管理</div>
            <div className="num" style={{ fontSize: 18 }}>漏斗 · 周期 · 成本</div>
            <div className="sub">候选人管线 / 需求 / 面试 / 渠道</div>
          </div>
          <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #dc2626' }} onClick={() => goto('cost')}>
            <div className="label">💰 薪酬成本</div>
            <div className="num" style={{ fontSize: 18 }}>公司口径 · 部门×类别</div>
            <div className="sub">成本总览 / 预算对比 / 预测</div>
          </div>
          <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #7c3aed' }} onClick={() => goto('candidates')}>
            <div className="label">📋 候选人管线</div>
            <div className="num" style={{ fontSize: 18 }}>{people.pendingHires + (people.offers || 0)} 人在流程</div>
            <div className="sub">待入职 {people.pendingHires} · 发 offer {people.offers}</div>
          </div>
          <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #10b981' }} onClick={() => goto('org')}>
            <div className="label">🏢 组织与编制</div>
            <div className="num" style={{ fontSize: 18 }}>{people.headcount} 人在职</div>
            <div className="sub">部门树 · 编制 vs 实际</div>
          </div>
        </div>
      </Card>

      <Card title={<>薪酬成本趋势（近 {trend.length} 个月）<Chip kind={backendUp ? 'ok' : 'gray'}>{backendUp ? '真实数据' : '演示回退'}</Chip></>} style={{ marginTop: 14 }}>
        <Chart type="line" area data={trendData} color="#2f54eb" ySuffix="万" />
        <Hint style={{ marginTop: 6 }}>{trend[0]?.label} {trend[0]?.value}万（{trend[0]?.count}人）→ {trend[trend.length - 1]?.label} {trend[trend.length - 1]?.value}万（{trend[trend.length - 1]?.count}人）</Hint>
      </Card>

      <div className="grid g2">
        <Card title={<>成本环比 {summary.mom > 0 ? '+' : ''}{summary.mom}% 归因 <Hint style={{ display: 'inline' }}>真实工资单计算</Hint></>}>
          {attrs.length ? attrs.map(a => (
            <div className="attrib" key={a.label}><span>{a.label}</span><b className={a.v > 0 ? '' : 'down'}>{a.v > 0 ? '+' : ''}{a.v}万</b></div>
          )) : <Hint>本月无显著结构性变化</Hint>}
          <div className="attrib"><span>合计</span><b>{summary.attribution.deltaWan}万</b></div>
        </Card>
        <Card title={<>薪资分布 <Hint style={{ display: 'inline' }}>按岗位类别 · 职级</Hint></>}>
          <div className="chip-row">
            {CATEGORIES.map(([k, label]) => (
              <button key={k} className={`btn sm ${cat === k ? 'primary' : ''}`} onClick={() => setCat(k)}>{label}</button>
            ))}
          </div>
          <Chart type="bar" data={distData} color="#38bdf8" ySuffix="K" refLine={dist.refP50 ? { value: dist.refP50, label: `市场 P50 ${dist.refP50}K` } : null} />
          <Hint style={{ marginTop: 10 }}>{CATEGORIES.find(c => c[0] === cat)[1]}岗 {dist.count || 0} 人 · 职级平均月薪；技术岗参考市场 P50（{dist.refP50}K）</Hint>
        </Card>
      </div>

      <div className="grid g2">
        <Card title={<>成本预测 <Hint style={{ display: 'inline' }}>线性外推</Hint></>}>
          <Hint>扩至 <b>{d.forecast.target}</b> 人（当前 {people.headcount} 人）：<b style={{ color: 'var(--accent)' }}>月薪酬成本 ≈ ¥{d.forecast.monthlyCostWan}万</b></Hint>
          <Hint style={{ marginTop: 8 }}>{d.forecast.note}</Hint>
          <div style={{ marginTop: 12 }}><Btn sm onClick={() => goto('copilot')}>问 AI：这个季度成本涨在哪里？</Btn></div>
        </Card>
        <Card title={<>留才预警 <Chip kind={d.attrition.length ? 'warn' : 'ok'}>{d.attrition.length} 人</Chip></>}>
          <table>
            <tr><th>员工</th><th>岗位</th><th>年薪</th><th>带宽 P50</th><th>风险</th></tr>
            {d.attrition.map(a => (
              <tr key={a.name}><td>{a.name}</td><td>{a.job_family}</td><td>{a.annual}万</td><td>{a.p50 ? a.p50 + '万' : '—'}</td><td><Chip kind={a.risk === '高' ? 'bad' : 'warn'}>{a.risk}</Chip></td></tr>
            ))}
            {!d.attrition.length && <tr><td colSpan={5}><Hint>当前无预警对象</Hint></td></tr>}
          </table>
        </Card>
      </div>
    </>
  )
}
