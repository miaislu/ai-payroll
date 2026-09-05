import { useEffect, useState } from 'react'
import Chart from '../components/Chart.jsx'
import { Card, Chip, Hint, Btn } from '../components/ui.jsx'
import { api } from '../api.js'
import { CAN_APPROVE } from '../data.js'
import { currentPeriod } from '../lib/period.js'

const CATEGORIES = [['all', '全部'], ['tech', '技术'], ['support', '职能'], ['mgmt', '管理']]

export default function Dashboard({ goto, backendUp, user, approvals }) {
  const role = user?.role || 'founder'
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [cat, setCat] = useState('all')
  const [empView, setEmpView] = useState(null)
  const pendingMine = (approvals || []).filter(a => a.status === 'pending' && CAN_APPROVE(role, a.type)).length

  useEffect(() => {
    if (role === 'emp') return
    if (!backendUp) { setError('后端不可用，无法读取真实经营数据'); setD(null); return }
    let alive = true
    ;(async () => {
      try {
        const [summary, trend, distAll, attrition, forecast] = await Promise.all([
          api('/dashboard/summary?period=' + currentPeriod()), api('/dashboard/trend?months=6'),
          api('/dashboard/distribution?category=all'), api('/dashboard/attrition'), api('/dashboard/forecast?target=60')
        ])
        if (alive) { setD({ summary, trend, distAll, dist: distAll, attrition, forecast }); setError('') }
      } catch (e) { if (alive) { setD(null); setError(e.message || '仪表盘加载失败') } }
    })()
    return () => { alive = false }
  }, [backendUp, role])

  // 类别 tab：切换时拉取对应分布
  useEffect(() => {
    let alive = true
    if (!backendUp || role === 'emp') return
    api('/dashboard/distribution?category=' + cat).then(r => alive && setD(prev => prev && { ...prev, dist: r })).catch(() => {})
    return () => { alive = false }
  }, [cat, backendUp, role])

  // 员工视角：个人薪酬概览
  useEffect(() => {
    let alive = true
    if (role === 'emp' && backendUp) api('/payslip/me').then(r => alive && setEmpView(r)).catch(() => {})
    return () => { alive = false }
  }, [role, backendUp])

  if (role === 'emp') {
    const tax = empView?.items?.find(i => i.label.includes('个人所得税') || i.label.includes('个税'))?.value
    return (
      <>
        <div className="grid g4">
          <div className="card kpi"><div className="label">本月实发</div><div className="num" style={{ fontSize: 22 }}>¥{empView?.net || '—'}</div><div className="sub flat">{empView?.period || '—'}</div></div>
          <div className="card kpi"><div className="label">本月个税</div><div className="num" style={{ fontSize: 19 }}>{tax || '—'}</div><div className="sub flat">累计预扣法</div></div>
          <div className="card kpi"><div className="label">期权</div><div className="num" style={{ fontSize: 19 }}>{empView?.option?.vested || '无台账'}</div><div className="sub flat">{empView?.option?.est_value || ''}</div></div>
          <div className="card kpi"><div className="label">薪酬状态</div><div className="num" style={{ fontSize: 19, color: 'var(--ok)' }}>可查看</div><div className="sub flat">疑问请联系 HR</div></div>
        </div>
        <div className="grid g2">
          <Card title="我的薪酬单"><Btn sm onClick={() => goto('payslip')}>查看完整薪酬单 →</Btn></Card>
          <Card title="有薪酬问题？"><Btn sm onClick={() => goto('copilot')}>问 AI 助手 →</Btn></Card>
        </div>
      </>
    )
  }

  if (error) return <Card><Hint>{error}。页面不会使用演示数据代替真实数据。</Hint></Card>
  if (!d) return <Card><Hint>仪表盘加载中…</Hint></Card>
  const { summary, trend } = d
  const dist = d.dist || d.distAll
  const people = summary.people || { headcount: summary.headcount, pendingHires: 0, pendingLeavers: 0, offers: 0, byCategory: [] }
  const catCount = c => people.byCategory?.find(x => x.category === c)?.c ?? '-'
  const trendData = trend.map(t => ({ label: t.label, value: t.value }))
  const distData = dist.data.map((x, i) => ({ ...x, color: ['#38bdf8', '#93b4fd', '#0ea5e9', '#2f54eb'][i % 4] }))

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
          <div className="card kpi"><div className="label">待入职</div><div className="num">{people.pendingHires}</div><div className="sub warn">当前账期之后到岗</div></div>
          <div className="card kpi"><div className="label">待离职</div><div className="num">{people.pendingLeavers}</div><div className="sub warn">已提计划</div></div>
          <div className="card kpi"><div className="label">发 offer</div><div className="num">{people.offers}</div><div className="sub ok">待确认入职</div></div>
        </div>
      ) : (
        <div className="grid g4">
          <div className="card kpi"><div className="label">本月算薪</div><div className="num" style={{ fontSize: 17, paddingTop: 6 }}><Chip kind="info">查看月结状态</Chip></div><div className="sub flat">以工资批次状态为准</div></div>
          <div className="card kpi"><div className="label">待我审批</div><div className="num">{pendingMine}</div><div className="sub warn">{role === 'finance' ? '调薪 / Offer / 期权' : '带宽由你处理；发钱类归财务'}</div></div>
          <div className="card kpi"><div className="label">员工总数</div><div className="num">{people.headcount}</div><div className="sub flat">技术 {catCount('tech')} / 职能 {catCount('support')} / 管理 {catCount('mgmt')}</div></div>
          <div className="card kpi"><div className="label">本月薪酬成本</div><div className="num" style={{ fontSize: 20 }}>¥{summary.total.toLocaleString('zh-CN')}</div><div className={`sub ${momCls}`}>环比 {summary.mom > 0 ? '+' : ''}{summary.mom}%</div></div>
        </div>
      )}

      <Card title="人力模块" style={{ marginTop: 14 }}>
        <div className="grid g4">
          {role === 'finance' ? (
            <>
              <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #2f54eb' }} onClick={() => goto('payroll')}>
                <div className="label">算薪工作台</div>
                <div className="num" style={{ fontSize: 18 }}>预览 · 锁定月结</div>
                <div className="sub">财务复核后才锁定该月工资</div>
              </div>
              <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #d97706' }} onClick={() => goto('expenses')}>
                <div className="label">报销与预支</div>
                <div className="num" style={{ fontSize: 18 }}>审批 · 打款 · 核销</div>
                <div className="sub">员工提交后由财务或 CEO 处理</div>
              </div>
              <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #7c3aed' }} onClick={() => goto('approvals')}>
                <div className="label">审批中心</div>
                <div className="num" style={{ fontSize: 18 }}>{pendingMine} 项待你处理</div>
                <div className="sub">调薪 / Offer / 期权</div>
              </div>
              <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #dc2626' }} onClick={() => goto('cost')}>
                <div className="label">成本总览</div>
                <div className="num" style={{ fontSize: 18 }}>公司口径 · 部门×类别</div>
                <div className="sub">成本总览 / 预算对比 / 预测</div>
              </div>
            </>
          ) : (
            <>
              <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #2f54eb' }} onClick={() => goto('recruiting')}>
                <div className="label">招聘管理</div>
                <div className="num" style={{ fontSize: 18 }}>漏斗 · 周期 · 成本</div>
                <div className="sub">候选人管线 / 需求 / 面试 / 渠道</div>
              </div>
              <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #dc2626' }} onClick={() => goto('cost')}>
                <div className="label">薪酬成本</div>
                <div className="num" style={{ fontSize: 18 }}>公司口径 · 部门×类别</div>
                <div className="sub">成本总览 / 预算对比 / 预测</div>
              </div>
              <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #7c3aed' }} onClick={() => goto('candidates')}>
                <div className="label">候选人管线</div>
                <div className="num" style={{ fontSize: 18 }}>{people.pendingHires + (people.offers || 0)} 人在流程</div>
                <div className="sub">待入职 {people.pendingHires} · 发 offer {people.offers}</div>
              </div>
              <div className="card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid #10b981' }} onClick={() => goto('org')}>
                <div className="label">组织与编制</div>
                <div className="num" style={{ fontSize: 18 }}>{people.headcount} 人在职</div>
                <div className="sub">部门树 · 编制 vs 实际</div>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card title={<>薪酬成本趋势（近 {trend.length} 个月）<Chip kind="ok">后端计算</Chip></>} style={{ marginTop: 14 }}>
        <Chart type="line" area data={trendData} color="#2f54eb" ySuffix="万" />
        <Hint style={{ marginTop: 6 }}>{trend[0]?.label} {trend[0]?.value}万（{trend[0]?.count}人）→ {trend[trend.length - 1]?.label} {trend[trend.length - 1]?.value}万（{trend[trend.length - 1]?.count}人）</Hint>
      </Card>

      <div className="grid g2">
        <Card title={<>成本环比 {summary.mom > 0 ? '+' : ''}{summary.mom}% 归因 <Hint style={{ display: 'inline' }}>公司成本口径</Hint></>}>
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
          <Hint style={{ marginTop: 10 }}>{CATEGORIES.find(c => c[0] === cat)[1]}岗 {dist.count || 0} 人 · 职级平均月薪；{dist.refP50 ? `技术岗参考已审批市场 P50（${dist.refP50}K）` : '暂无已审批市场带宽，不展示市场参考线'}</Hint>
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
            <thead><tr><th>员工</th><th>岗位</th><th>年薪</th><th>带宽 P50</th><th>风险</th></tr></thead>
            <tbody>
              {d.attrition.map(a => (
                <tr key={a.name}><td>{a.name}</td><td>{a.job_family}</td><td>{a.annual}万</td><td>{a.p50 ? a.p50 + '万' : '—'}</td><td><Chip kind={a.risk === '高' ? 'bad' : 'warn'}>{a.risk}</Chip></td></tr>
              ))}
              {!d.attrition.length && <tr><td colSpan={5}><Hint>当前无预警对象</Hint></td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  )
}
