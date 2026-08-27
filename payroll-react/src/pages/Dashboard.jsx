import { useEffect, useState } from 'react'
import Chart from '../components/Chart.jsx'
import { Card, Chip, Hint, Btn } from '../components/ui.jsx'
import { api } from '../api.js'

// 后端不可用时的本地演示回退（与真实种子数据同口径）
const FALLBACK = {
  summary: { period: '2025-06', total: 322525, prev: 254207, mom: 26.9, headcount: 9, penetration: 0, attribution: { newHire: 0, severance: 68.3, socialAdj: 0, other: 0, deltaWan: 68.3 } },
  trend: [
    { period: '2025-01', label: '1月', value: 7, count: 3 }, { period: '2025-02', label: '2月', value: 15.5, count: 5 },
    { period: '2025-03', label: '3月', value: 20.7, count: 7 }, { period: '2025-04', label: '4月', value: 23.3, count: 8 },
    { period: '2025-05', label: '5月', value: 25.4, count: 9 }, { period: '2025-06', label: '6月', value: 32.3, count: 10 }
  ],
  distribution: { data: [{ label: 'P4', value: 22 }, { label: 'P5', value: 36.1 }], refP50: 50 },
  attrition: [{ name: '王**', job_family: '模拟IC设计', annual: 58, p50: 50, risk: '高' }, { name: '张三', job_family: '模拟IC设计', annual: 30, p50: 50, risk: '中' }],
  forecast: { target: 60, currentHeadcount: 9, monthlyCostWan: 215, note: '线性外推：月成本 ≈ 当前月成本 × 目标人数 / 现有人数' }
}

export default function Dashboard({ goto, backendUp }) {
  const [d, setD] = useState(null) // null=加载中
  const load = async () => {
    try {
      const [summary, trend, distribution, attrition, forecast] = await Promise.all([
        api('/dashboard/summary?period=2025-06'), api('/dashboard/trend?months=6'),
        api('/dashboard/distribution'), api('/dashboard/attrition'), api('/dashboard/forecast?target=60')
      ])
      setD({ summary, trend, distribution, attrition, forecast })
    } catch { setD(FALLBACK) }
  }
  useEffect(() => { load() }, [backendUp])

  if (!d) return <Card><Hint>仪表盘加载中…</Hint></Card>
  const { summary, trend, distribution, attrition, forecast } = d
  const momCls = summary.mom > 0 ? 'up' : 'down'
  const trendData = trend.map(t => ({ label: t.label, value: t.value }))
  const distData = distribution.data.map(x => ({ ...x, color: x.label === 'P4' ? '#93b4fd' : '#38bdf8' }))
  const attrs = [
    { label: '新招聘', v: summary.attribution.newHire },
    { label: '离职结算', v: summary.attribution.severance },
    { label: '社保基数调整', v: summary.attribution.socialAdj },
    { label: '其他', v: summary.attribution.other }
  ].filter(a => Math.abs(a.v) > 0.05)

  return (
    <>
      <div className="grid g4">
        <div className="card kpi"><div className="label">本月薪酬成本（{summary.period}）</div><div className="num">¥{summary.total.toLocaleString('zh-CN')}</div><div className={`sub ${momCls}`}>环比 {summary.mom > 0 ? '+' : ''}{summary.mom}%</div></div>
        <div className="card kpi"><div className="label">在职人数</div><div className="num">{summary.headcount}</div><div className="sub flat">带宽穿透率 {summary.penetration}%</div></div>
        <div className="card kpi"><div className="label">待审批事项</div><div className="num">4</div><div className="sub warn">带宽×1 · 调薪×2 · 期权×1 · Offer×1</div></div>
        <div className="card kpi"><div className="label">本月算薪状态</div><div className="num" style={{ fontSize: 17, paddingTop: 6 }}><Chip kind="ok">✓ 已发放</Chip></div><div className="sub flat">规则引擎生成 · 人工复核</div></div>
      </div>

      <Card title={<>薪酬成本趋势（近 {trend.length} 个月）<Chip kind={backendUp ? 'ok' : 'gray'}>{backendUp ? '真实数据' : '演示回退'}</Chip></>}>
        <Chart type="line" area data={trendData} color="#2f54eb" ySuffix="万" />
        <Hint style={{ marginTop: 6 }}>随招聘扩张自然增长：{trend[0]?.label} {trend[0]?.value}万（{trend[0]?.count}人）→ {trend[trend.length - 1]?.label} {trend[trend.length - 1]?.value}万（{trend[trend.length - 1]?.count}人）</Hint>
      </Card>

      <div className="grid g2">
        <Card title={<>成本环比 {summary.mom > 0 ? '+' : ''}{summary.mom}% 归因 <Hint style={{ display: 'inline' }}>真实工资单计算</Hint></>}>
          {attrs.length ? attrs.map(a => (
            <div className="attrib" key={a.label}><span>{a.label}</span><b className={a.v > 0 ? '' : 'down'}>{a.v > 0 ? '+' : ''}{a.v}万</b></div>
          )) : <Hint>本月无显著结构性变化</Hint>}
          <div className="attrib"><span>合计</span><b>{summary.attribution.deltaWan}万</b></div>
        </Card>
        <Card title={<>薪资分布（按职级 · 现金 P50 参考）</>}>
          <Chart type="bar" data={distData} color="#38bdf8" ySuffix="K" refLine={distribution.refP50 ? { value: distribution.refP50, label: `市场 P50 ${distribution.refP50}K` } : null} />
          <Hint style={{ marginTop: 10 }}>职级平均月薪 vs 模拟IC设计市场 P50（{distribution.refP50}K）；P5 均值含资深档位</Hint>
        </Card>
      </div>

      <div className="grid g2">
        <Card title={<>成本预测 <Hint style={{ display: 'inline' }}>线性外推（基于真实数据）</Hint></>}>
          <Hint>扩至 <b>{forecast.target}</b> 人（当前 {forecast.currentHeadcount} 人）：<b style={{ color: 'var(--accent)' }}>月薪酬成本 ≈ ¥{forecast.monthlyCostWan}万</b></Hint>
          <Hint style={{ marginTop: 8 }}>{forecast.note}</Hint>
          <div style={{ marginTop: 12 }}><Btn sm onClick={() => goto('copilot')}>问 AI：这个季度成本涨在哪里？</Btn></div>
        </Card>
        <Card title={<>留才预警 <Chip kind={attrition.length ? 'warn' : 'ok'}>{attrition.length} 人</Chip></>}>
          <table>
            <tr><th>员工</th><th>岗位</th><th>年薪</th><th>带宽 P50</th><th>风险</th></tr>
            {attrition.map(a => (
              <tr key={a.name}><td>{a.name}</td><td>{a.job_family}</td><td>{a.annual}万</td><td>{a.p50 ? a.p50 + '万' : '—'}</td><td><Chip kind={a.risk === '高' ? 'bad' : 'warn'}>{a.risk}</Chip></td></tr>
            ))}
          </table>
          <Hint style={{ marginTop: 8 }}>判定：留才预警标记 或 年薪低于带宽 P50 的 85%（真实带宽数据）</Hint>
        </Card>
      </div>
    </>
  )
}
