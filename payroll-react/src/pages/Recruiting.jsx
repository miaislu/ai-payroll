import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Kpi } from '../components/ui.jsx'
import Chart from '../components/Chart.jsx'
import { getRecruitingStats, getRequisitions } from '../api.js'
import { CANDIDATE_STAGES, REQUISITION_STATUS } from '../data.js'

const wan = v => '¥' + (Math.round(v / 100) / 100).toFixed(0) + '万'

export default function Recruiting({ toast, backendUp, goto }) {
  const [stats, setStats] = useState(null)
  const [reqs, setReqs] = useState(null)

  const load = async () => {
    try {
      setStats(await getRecruitingStats())
      setReqs(await getRequisitions())
    } catch { toast('招聘数据加载失败（后端不可用）') }
  }
  useEffect(() => { load() }, [backendUp])

  const statusLabel = k => REQUISITION_STATUS.find(s => s.key === k)?.label || k
  const statusKind = k => ({ open: 'ok', interview: 'info', draft: 'gray', closed: 'gray', cancelled: 'warn' }[k] || 'gray')
  const stageColor = k => CANDIDATE_STAGES.find(s => s.key === k)?.color || '#64748b'

  const openReqs = reqs?.filter(r => ['open', 'interview'].includes(r.status)) || []
  const funnelMax = stats ? Math.max(1, ...stats.funnel.map(f => f.count)) : 1

  return (
    <>
      <div className="grid g4">
        <Kpi label="进行中需求" num={openReqs.length} sub="开放 + 面试中" numColor="#2f54eb" />
        <Kpi label="人均招聘成本" num={stats ? wan(stats.costPerHire) : '—'} sub={`累计渠道费用 ${stats ? wan(stats.totalCost) : '—'}`} numColor="#d97706" />
        <Kpi label="平均招聘周期" num={stats ? stats.avgCycle + ' 天' : '—'} sub="申请 → 入职" numColor="#7c3aed" />
        <Kpi label="Offer 接受率" num={stats ? stats.acceptRate + '%' : '—'} sub={`入职 ${stats?.hires || 0} 人`} numColor="#10b981" />
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
          <tr><th>渠道</th><th>候选人</th><th>入职</th><th>费用</th><th>人均招聘成本</th></tr>
          {stats?.channels.map(c => (
            <tr key={c.name}>
              <td><b>{c.name}</b></td>
              <td>{c.candidates}</td>
              <td><Chip kind="ok">{c.hired}</Chip></td>
              <td>{c.cost ? wan(c.cost) : '—'}</td>
              <td>{c.costPerHire ? wan(c.costPerHire) : '—'}</td>
            </tr>
          ))}
          {stats && !stats.channels.length && <tr><td colSpan={5}><Hint>暂无渠道数据</Hint></td></tr>}
        </table>
      </Card>

      <Card title={<>进行中的招聘需求 <Chip kind="info">{openReqs.length} 个</Chip></>} style={{ marginTop: 14 }}>
        <table>
          <tr><th>岗位</th><th>部门</th><th>职级</th><th>城市</th><th>编制</th><th>已入职/进行中</th><th>状态</th><th>操作</th></tr>
          {openReqs.map(r => (
            <tr key={r.id}>
              <td><b>{r.title}</b></td>
              <td>{r.department}</td>
              <td>{r.grade}</td>
              <td>{r.city}</td>
              <td>{r.headcount} 人</td>
              <td>{r.filled} / {r.active_candidates}</td>
              <td><Chip kind={statusKind(r.status)}>{statusLabel(r.status)}</Chip>{r.priority === 'high' && <Chip kind="warn">高优</Chip>}</td>
              <td><button className="btn sm" onClick={() => goto('requisitions')}>管理</button></td>
            </tr>
          ))}
          {!openReqs.length && <tr><td colSpan={8}><Hint>暂无进行中的招聘需求</Hint></td></tr>}
        </table>
      </Card>
    </>
  )
}
