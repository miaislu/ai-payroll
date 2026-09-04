import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Stepper } from '../components/ui.jsx'
import { TYPE_LABEL, CAN_APPROVE } from '../data.js'

const BAND_APPROVE = '带宽由 HR 或 CEO 审批'
const MONEY_APPROVE = '该项由财务或 CEO 审批'

function pickApproval(approvals, type) {
  return (approvals || []).find(a => a.type === type && a.status === 'pending')
    || (approvals || []).find(a => a.type === type)
}

function wan(n) {
  const v = Number(n)
  return Number.isFinite(v) ? v : ''
}

// ── 审批中心 ──
export function ApprovalsPage({ approvals, goto, user }) {
  const pending = approvals.filter(a => a.status === 'pending')
  const mine = pending.filter(a => CAN_APPROVE(user?.role, a.type))
  const waiting = pending.filter(a => !CAN_APPROVE(user?.role, a.type))
  const done = approvals.filter(a => a.status !== 'pending')
  const card = (a, right) => (
    <div className="apr-item" key={a.id}>
      <div style={{ flex: 1 }}>
        <div><Chip kind="info">{TYPE_LABEL[a.type]}</Chip> <b>{a.title}</b></div>
        <div className="hint">{a.who} · {a.key}</div>
        <div className="hint">{a.summary}</div>
      </div>
      {right}
    </div>
  )
  return (
    <>
      <Card title={<>待我审批 <Chip kind="warn">{mine.length} 项</Chip></>}>
        <Hint style={{ marginBottom: 8 }}>带宽：HR / CEO。调薪、期权、Offer：财务 / CEO。</Hint>
        {mine.length ? mine.map(a => card(a, <Btn sm primary onClick={() => goto(a.page)}>查看处理</Btn>)) : <Hint style={{ padding: '8px 0' }}>没有需要你处理的事项</Hint>}
      </Card>
      {waiting.length > 0 && (
        <Card title={<>待其他人处理 <Chip kind="gray">{waiting.length} 项</Chip></>}>
          {waiting.map(a => card(a, <Btn sm onClick={() => goto(a.page)}>查看</Btn>))}
        </Card>
      )}
      <Card title="已完成">
        {done.map(a => card(a, <Chip kind={a.status === 'approved' ? 'ok' : 'bad'}>{a.status === 'approved' ? '已通过' : '已驳回'}</Chip>))}
      </Card>
    </>
  )
}

// ── F1 带宽审批 ──
export function BandApprovalPage({ approvals, act, toast, user }) {
  const item = pickApproval(approvals, 'band')
  const payload = item?.payload || {}
  const from = payload.from || {}
  const [p25, setP25] = useState(String(payload.to?.p25 ?? ''))
  const [p50, setP50] = useState(String(payload.to?.p50 ?? ''))
  const [p75, setP75] = useState(String(payload.to?.p75 ?? ''))
  useEffect(() => {
    setP25(String(payload.to?.p25 ?? ''))
    setP50(String(payload.to?.p50 ?? ''))
    setP75(String(payload.to?.p75 ?? ''))
  }, [item?.id, payload.to?.p25, payload.to?.p50, payload.to?.p75])
  const canAct = CAN_APPROVE(user?.role, 'band')
  if (!item) return <Card title="带宽审批"><Hint>没有带宽审批。请在「对标与带宽」用导入样本生成草稿。</Hint></Card>
  const pending = item.status === 'pending'
  const approve = () => {
    if (!canAct) return toast(BAND_APPROVE)
    const to = { p25: Number(p25), p50: Number(p50), p75: Number(p75) }
    act(item.id, 'approved', `P50 ${from.p50}万 → ${to.p50}万 · 已固化`, '', { to })
    toast(`带宽已写入对标库（P50=${to.p50}万）`)
  }
  const reject = () => { act(item.id, 'rejected'); toast('已驳回') }
  const pct = (a, b) => (a && b ? `${((b - a) / a * 100).toFixed(1)}%` : '—')
  return (
    <>
      <Card><Stepper steps={['① HR 发起', '② 样本草稿', '③ HR/CEO 审批', '④ 固化生效']} current={pending ? 2 : 3} /></Card>
      <Card title={<>{item.title} <Chip kind="info">{item.id}</Chip>{!pending && <Chip kind={item.status === 'approved' ? 'ok' : 'bad'}>{item.status === 'approved' ? '已通过' : '已驳回'}</Chip>}</>}>
        <Hint>同意后写入对标库。样本来自 CSV/JSON 导入，不是猎聘/Boss 抓取。</Hint>
        <table>
          <thead><tr><th>分位</th><th>当前带宽</th><th>草稿（可改）</th><th>变化</th></tr></thead>
          <tbody>
            <tr><td>P25</td><td>{wan(from.p25)}万</td><td><input type="number" value={p25} onChange={e => setP25(e.target.value)} min={10} max={200} style={{ width: 70 }} disabled={!pending || !canAct} /> 万</td><td>{pct(from.p25, Number(p25))}</td></tr>
            <tr><td>P50</td><td>{wan(from.p50)}万</td><td><input type="number" value={p50} onChange={e => setP50(e.target.value)} min={10} max={200} style={{ width: 70 }} disabled={!pending || !canAct} /> 万</td><td>{pct(from.p50, Number(p50))}</td></tr>
            <tr><td>P75</td><td>{wan(from.p75)}万</td><td><input type="number" value={p75} onChange={e => setP75(e.target.value)} min={10} max={200} style={{ width: 70 }} disabled={!pending || !canAct} /> 万</td><td>{pct(from.p75, Number(p75))}</td></tr>
          </tbody>
        </table>
        <Hint style={{ marginTop: 8 }}>{item.summary}{payload.sample ? ` · 样本 ${payload.sample} 条` : ''}</Hint>
        {item.action_by && <Hint>审批人：{item.action_by} · {item.action_at || ''}</Hint>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {pending ? (
            canAct ? (
              <>
                <Btn primary onClick={approve}>同意并固化</Btn>
                <Btn onClick={reject}>驳回</Btn>
              </>
            ) : <Hint>{BAND_APPROVE}</Hint>
          ) : <Hint>该审批已处理。</Hint>}
        </div>
      </Card>
    </>
  )
}

// ── F4 调薪审批 ──
export function RaiseApprovalPage({ approvals, act, toast, user }) {
  const item = pickApproval(approvals, 'raise')
  const payload = item?.payload || {}
  const emp = item?.employee
  const [optExtra, setOptExtra] = useState(Boolean(payload.option_share_count))
  const canAct = CAN_APPROVE(user?.role, 'raise')
  if (!item) return <Card title="调薪审批"><Hint>没有调薪审批。可在「绩效评级」按 S/A/B 发起。</Hint></Card>
  const pending = item.status === 'pending'
  const fromY = payload.from_monthly ? Math.round(payload.from_monthly * 12 / 10000) : null
  const toY = payload.to_monthly ? Math.round(payload.to_monthly * 12 / 10000) : null
  const approve = () => {
    if (!canAct) return toast(MONEY_APPROVE)
    act(item.id, 'approved', item.key + (optExtra ? ' · 期权+0.1万股' : ''), '', { option_share_count: optExtra ? 0.1 : 0 })
    toast('调薪已写入员工月薪' + (optExtra ? '，并加授 0.1 万股' : ''))
  }
  return (
    <>
      <Card><Stepper steps={['① 发起（绩效/留才）', '② 建议', '③ 财务/CEO 审批', '④ 生效']} current={pending ? 2 : 3} /></Card>
      <Card title={<>{item.title} {emp?.flag === '留才预警' && <Chip kind="warn">留才预警</Chip>}<Chip kind="info">{item.id}</Chip></>}>
        <Hint>同意后更新员工月薪，并记入入转调离事件。未提交月份的算薪会引用新月薪。</Hint>
        <div className="grid g3" style={{ marginBottom: 10 }}>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">当前年薪</div><div className="num">{fromY != null ? fromY + '万' : '—'}</div><div className="sub flat">{emp ? `${emp.name} · ${emp.grade}` : ''}</div></div>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">绩效</div><div className="num" style={{ color: 'var(--ok)' }}>{payload.rating || '—'}</div><div className="sub flat">{payload.note || item.summary}</div></div>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">建议年薪</div><div className="num" style={{ color: 'var(--accent)' }}>{toY != null ? toY + '万' : '—'}</div><div className="sub flat">月薪 {payload.to_monthly?.toLocaleString('zh-CN') || '—'}</div></div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={optExtra} onChange={e => setOptExtra(e.target.checked)} id="opt-extra" disabled={!pending || !canAct} />
          <label style={{ fontSize: 13 }} htmlFor="opt-extra">同时加授期权 0.1 万股（写入授予台账）</label>
        </div>
        {item.action_by && <Hint style={{ marginTop: 8 }}>审批人：{item.action_by} · {item.action_at || ''}</Hint>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {pending ? (
            canAct ? (
              <>
                <Btn primary onClick={approve}>同意调薪</Btn>
                <Btn onClick={() => act(item.id, 'rejected')}>驳回</Btn>
              </>
            ) : <Hint>{MONEY_APPROVE}</Hint>
          ) : <Hint>该审批已处理。</Hint>}
        </div>
      </Card>
    </>
  )
}

export function OptionApprovalPage({ approvals, act, toast, user }) {
  const item = pickApproval(approvals, 'option')
  const payload = item?.payload || {}
  const emp = item?.employee
  const canAct = CAN_APPROVE(user?.role, 'option')
  if (!item) return <Card title="期权审批"><Hint>没有期权授予审批。</Hint></Card>
  const pending = item.status === 'pending'
  return (
    <>
      <Card><Stepper steps={['① HR 发起', '② 条款确认', '③ 财务/CEO 审批', '④ 写入台账']} current={pending ? 2 : 3} /></Card>
      <Card title={<>{item.title} <Chip kind="info">{item.id}</Chip></>}>
        <Hint>同意后写入期权授予台账。股数为万股口径，与台账一致。</Hint>
        <div className="grid g3" style={{ marginBottom: 10 }}>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">员工</div><div className="num" style={{ fontSize: 20 }}>{emp?.name || payload.employee_id || '—'}</div><div className="sub flat">{emp ? `${emp.job_family} ${emp.grade}` : ''}</div></div>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">授予股数</div><div className="num">{payload.share_count ?? '—'} 万股</div><div className="sub flat">行权价 {payload.exercise_price ?? 1} / 公允价 {payload.fair_value ?? 50}</div></div>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">归属</div><div className="num" style={{ fontSize: 20 }}>{payload.vesting_months || 48} 月</div><div className="sub flat">cliff {payload.cliff_months || 12} 月</div></div>
        </div>
        {item.action_by && <Hint>审批人：{item.action_by} · {item.action_at || ''}</Hint>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {pending ? (
            canAct ? (
              <>
                <Btn primary onClick={() => { act(item.id, 'approved'); toast('期权已写入授予台账') }}>同意授予</Btn>
                <Btn onClick={() => act(item.id, 'rejected')}>驳回</Btn>
              </>
            ) : <Hint>{MONEY_APPROVE}</Hint>
          ) : <Hint>该审批已处理。</Hint>}
        </div>
      </Card>
    </>
  )
}

// ── F2 Offer 审批 ──
export function OfferApprovalPage({ approvals, act, toast, user, goto }) {
  const canAct = CAN_APPROVE(user?.role, 'offer')
  const real = approvals?.find(a => a.type === 'offer' && a.ref && a.status === 'pending')
    || approvals?.find(a => a.type === 'offer' && a.ref)
    || pickApproval(approvals, 'offer')
  if (!real) {
    return (
      <Card title="Offer 审批">
        <Hint>没有 Offer 审批。请在「候选人管线」对 Offer 阶段的候选人发起。</Hint>
        {goto && (user?.role === 'hr' || user?.role === 'founder') && (
          <div style={{ marginTop: 10 }}><Btn sm onClick={() => goto('candidates')}>打开候选人管线</Btn></div>
        )}
      </Card>
    )
  }
  const c = real.ref
  const approve = () => {
    if (!canAct) return toast(MONEY_APPROVE)
    const comment = prompt('审批意见（可选）：', '带宽内，同意') || ''
    act(real.id, 'approved', real.key, comment)
    toast('已同意 Offer，候选人状态已更新')
  }
  const reject = () => {
    if (!canAct) return toast(MONEY_APPROVE)
    const comment = prompt('驳回理由：') || ''
    act(real.id, 'rejected', undefined, comment)
    toast('已驳回')
  }
  return (
    <>
      <Card><Stepper steps={['① 招聘需求', '② AI 对标建议', '③ 财务/CEO 审批', '④ 发出 Offer']} current={real.status === 'pending' ? 2 : 3} /></Card>
      <Card title={<>{real.title} <Chip kind="info">{real.id}</Chip></>}>
        <div className="grid g3" style={{ marginBottom: 10 }}>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">候选人</div><div className="num" style={{ fontSize: 20 }}>{c?.name || '—'}</div><div className="sub flat">{real.summary}</div></div>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">Offer 现金</div><div className="num" style={{ fontSize: 20, color: '#d97706' }}>{c?.offer_amount != null ? `¥${c.offer_amount.toLocaleString('zh-CN')}/月` : '—'}</div><div className="sub flat">申请：{real.key}</div></div>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">审批状态</div><div className="num" style={{ fontSize: 18, color: real.status === 'approved' ? 'var(--ok)' : real.status === 'rejected' ? '#dc2626' : '#f59e0b' }}>{real.status === 'approved' ? '已通过' : real.status === 'rejected' ? '已驳回' : '待审批'}</div><div className="sub flat">发起人：{real.who}</div></div>
        </div>
        {real.status !== 'pending' && (
          <Hint style={{ marginBottom: 10 }}>审批人：{real.action_by || '—'} · {real.action_at || ''}{real.comment ? ` · 意见：${real.comment}` : ''}</Hint>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {real.status === 'pending' ? (
            canAct ? (
              <>
                <Btn primary onClick={approve}>同意发出 Offer</Btn>
                <Btn onClick={reject}>驳回（附理由）</Btn>
              </>
            ) : <Hint>{MONEY_APPROVE}。HR 可查看候选人与分位。</Hint>
          ) : <Btn onClick={() => toast('该审批已处理完毕')}>返回</Btn>}
        </div>
      </Card>
    </>
  )
}
