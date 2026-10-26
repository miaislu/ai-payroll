import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Kpi, Btn } from '../components/ui.jsx'
import Chart from '../components/Chart.jsx'
import { getRecruitingStats } from '../api.js'
import { CANDIDATE_STAGES, interviewRating } from '../data.js'
import { formatWanInt } from '../lib/format.js'
import { currentPeriod } from '../lib/period.js'

export default function Recruiting({ toast, backendUp, goto }) {
  const [stats, setStats] = useState(null)
  const [interviewMonth, setInterviewMonth] = useState(currentPeriod)

  const load = async () => {
    try {
      setStats(await getRecruitingStats())
    } catch { toast('招聘数据加载失败（后端不可用）') }
  }
  useEffect(() => { load() }, [backendUp])

  const stageColor = k => CANDIDATE_STAGES.find(s => s.key === k)?.color || '#64748b'

  const plan = stats?.requisitionPlan || { roles: 0, baseline: 0, maximum: 0, pendingRoles: 0, consultantRoles: 0, priority: [] }
  const p0 = plan.priority?.find(p => p.priority === 'P0') || { roles: 0, baseline: 0 }
  const funnelMax = stats ? Math.max(1, ...stats.funnel.map(f => f.count)) : 1
  const interviewSummary = stats?.interviewHistory?.find(item => item.month === interviewMonth)
    || { interviewed: 0, passed: 0, failed: 0, pending: 0, awaiting: 0, awaitingCandidates: [], rounds: 0, passRate: null, candidates: [] }

  return (
    <>
      <Card title="月度面试统计">
        <div className="toolbar">
          <label className="f" style={{ margin: 0 }}>统计月份
            <input type="month" value={interviewMonth} onChange={e => e.target.value && setInterviewMonth(e.target.value)} />
          </label>
          <Btn sm onClick={() => setInterviewMonth(currentPeriod())}>本月</Btn>
          <Hint>按面试日期归属月份；同一人当月去重，以当月最后一轮结论判断。“强烈推荐 / 推荐录用”为通过。</Hint>
        </div>
        <div className="grid g4">
          <Kpi label="待面试人数" num={stats ? interviewSummary.awaiting || 0 : '—'} sub="所选月份未完成的面试安排 · 按人去重" numColor="#0891b2" />
          <Kpi label={`${interviewMonth} 累计面试人数`} num={stats ? interviewSummary.interviewed : '—'} sub={`共 ${interviewSummary.rounds} 轮面试`} numColor="#2f54eb" />
          <Kpi label="通过人数" num={stats ? interviewSummary.passed : '—'} sub={`待定 ${interviewSummary.pending} 人 · 不通过 ${interviewSummary.failed} 人`} numColor="#10b981" />
          <Kpi label="通过率" num={interviewSummary.passRate == null ? '—' : `${interviewSummary.passRate}%`} sub="通过人数 ÷ 当月面试人数" numColor="#7c3aed" />
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer' }}>查看待面试人选（{interviewSummary.awaiting || 0} 人）</summary>
          <Hint>按计划日期归月；历史月份显示月末仍待面试的人选，已取消安排不计入。</Hint>
          <table><thead><tr><th>候选人</th><th>计划日期</th><th>面试轮次</th><th>操作</th></tr></thead>
            <tbody>{(interviewSummary.awaitingCandidates || []).map(item => <tr key={item.candidate_id}>
              <td>{item.candidate_name || '—'}</td><td>{item.interview_date}</td><td>第 {item.round_no} 轮</td>
              <td><Btn sm onClick={() => goto('interviews', item.candidate_id)}>查看安排</Btn></td>
            </tr>)}</tbody>
          </table>
          {!interviewSummary.awaiting && <Hint>该月份暂无待面试安排。</Hint>}
        </details>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer' }}>查看 {interviewMonth} 人选明细（{interviewSummary.interviewed} 人）</summary>
          <table>
            <thead><tr><th>候选人</th><th>应聘需求</th><th>当月轮数</th><th>最后面试日期</th><th>最后结论</th><th>操作</th></tr></thead>
            <tbody>{interviewSummary.candidates.map(item => <tr key={item.candidate_id}>
              <td>{item.candidate_name}</td><td>{item.requisition_title || '—'}</td><td>{item.rounds}</td><td>{item.interview_date}</td>
              <td><Chip kind={interviewRating(item.result).kind}>{interviewRating(item.result).label}</Chip></td>
              <td><Btn sm onClick={() => goto('interviews', item.candidate_id)}>面试记录</Btn></td>
            </tr>)}</tbody>
          </table>
          {!interviewSummary.candidates.length && <Hint>该月份暂无面试记录。</Hint>}
        </details>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer' }}>查看历史月份</summary>
          <table>
            <thead><tr><th>月份</th><th>待面试人数</th><th>面试人数</th><th>通过人数</th><th>通过率</th><th>操作</th></tr></thead>
            <tbody>{stats?.interviewHistory?.map(item => <tr key={item.month}>
              <td>{item.month}</td><td>{item.awaiting || 0}</td><td>{item.interviewed}</td><td>{item.passed}</td><td>{item.passRate == null ? '—' : `${item.passRate}%`}</td>
              <td><Btn sm onClick={() => setInterviewMonth(item.month)}>查看当月</Btn></td>
            </tr>)}</tbody>
          </table>
        </details>
      </Card>
      <div className="grid g4">
        <Kpi label="岗位方向" num={plan.roles || 0} sub={`待定 ${plan.pendingRoles || 0} · 顾问/专家 ${plan.consultantRoles || 0}`} numColor="#2f54eb" />
        <Kpi label="基准编制" num={plan.baseline || 0} sub="已明确的最低招聘人数" numColor="#10b981" />
        <Kpi label="弹性上限" num={plan.maximum || 0} sub={`较基准 +${Math.max(0, (plan.maximum || 0) - (plan.baseline || 0))}`} numColor="#7c3aed" />
        <Kpi label="P0 最高优先" num={p0.baseline || 0} sub={`${p0.roles || 0} 个岗位方向`} numColor="#dc2626" />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="候选人漏斗">
          {stats && stats.funnel.map(f => (
            <div key={f.stage} style={{ margin: '8px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 56, fontSize: 12, color: 'var(--muted)' }}>{f.label}</span>
              <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 6, height: 22 }}>
                <div style={{ width: `${f.count / funnelMax * 100}%`, background: stageColor(f.stage), height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', paddingLeft: 8, color: '#fff', fontSize: 11, fontWeight: 600, minWidth: f.count ? 24 : 0 }}>{f.count}</div>
              </div>
            </div>
          ))}
        </Card>

        <Card title="渠道费用（月度）">
          {stats ? (
            <>
              <Chart data={stats.monthly.map(m => ({ label: String(Number(m.year_month.slice(5))) + '月', value: Math.round(m.total / 10000 * 10) / 10 }))} type="bar" color="#d97706" ySuffix="万" />
              <Hint>月度渠道费用（万元）：BOSS直聘/猎聘/猎头/内推/校招合计</Hint>
            </>
          ) : <Hint>加载中…</Hint>}
        </Card>
      </div>

      <Card title="渠道效果" style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>渠道</th><th>候选人</th><th>入职</th><th>费用</th><th>人均招聘成本</th></tr></thead>
          <tbody>
          {stats?.channels.map(c => (
            <tr key={c.name}>
              <td><b>{c.name}</b></td>
              <td>{c.candidates}</td>
              <td><Chip kind="ok">{c.hired}</Chip></td>
              <td>{c.cost ? formatWanInt(c.cost) : '—'}</td>
              <td>{c.costPerHire ? formatWanInt(c.costPerHire) : '—'}</td>
            </tr>
          ))}
          {stats && !stats.channels.length && <tr><td colSpan={5}><Hint>暂无渠道数据</Hint></td></tr>}
          </tbody>
        </table>
      </Card>

      <div className="grid g4" style={{ marginTop: 14 }}>
        <Kpi label="人均招聘成本" num={stats ? formatWanInt(stats.costPerHire) : '—'} sub={`累计渠道费用 ${stats ? formatWanInt(stats.totalCost) : '—'}`} numColor="#d97706" />
        <Kpi label="平均招聘周期" num={stats ? stats.avgCycle + ' 天' : '—'} sub="申请 → 入职" numColor="#7c3aed" />
        <Kpi label="Offer 接受率" num={stats ? stats.acceptRate + '%' : '—'} sub={`入职 ${stats?.hires || 0} 人`} numColor="#10b981" />
        <Kpi label="进行中候选人" num={stats ? stats.funnel.filter(f => !['hired', 'rejected', 'withdrawn'].includes(f.stage)).reduce((sum, f) => sum + f.count, 0) : '—'} sub="新简历至 Offer" numColor="#2f54eb" />
      </div>
    </>
  )
}
