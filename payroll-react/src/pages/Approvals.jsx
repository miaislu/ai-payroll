import { useState } from 'react'
import { Card, Chip, Hint, Btn, Stepper } from '../components/ui.jsx'
import { TYPE_LABEL } from '../data.js'

// ── 审批中心 ──
export function ApprovalsPage({ approvals, goto }) {
  const pending = approvals.filter(a => a.status === 'pending')
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
      <Card title={<>待我审批 <Chip kind="warn">{pending.length} 项</Chip></>}>
        {pending.length ? pending.map(a => card(a, <Btn sm primary onClick={() => goto(a.page)}>查看处理</Btn>)) : <Hint style={{ padding: '8px 0' }}>暂无待审批事项 🎉</Hint>}
      </Card>
      <Card title="已完成">
        {done.map(a => card(a, <Chip kind={a.status === 'approved' ? 'ok' : 'bad'}>{a.status === 'approved' ? '已通过' : '已驳回'}</Chip>))}
      </Card>
    </>
  )
}

// ── F1 带宽审批 ──
export function BandApprovalPage({ act, toast }) {
  const [step, setStep] = useState(2)
  const [p50, setP50] = useState('62')
  const approve = () => {
    setStep(3)
    act('A-101', 'approved', `P50 58万 → ${p50}万 · 已固化`)
    toast(`带宽已固化（P50=${p50}万），后续定薪/调薪自动引用`)
  }
  const reject = () => { setStep(3); act('A-101', 'rejected'); toast('已驳回，将通知发起人补充说明（原型演示）') }
  return (
    <>
      <Card><Stepper steps={['① HR 发起', '② AI 草稿生成', '③ 创始人审批', '④ 固化生效']} current={step} /></Card>
      <Card title={<>带宽刷新 · 模拟IC设计（上海 · 3-5 年）<Chip kind="info">A-101</Chip></>}>
        <table>
          <tr><th>分位</th><th>当前带宽</th><th>AI 草稿</th><th>市场参考（近 90 天）</th><th>调整</th></tr>
          <tr><td>P25</td><td>45万</td><td>48万</td><td>46-50万</td><td className="up">+6.7%</td></tr>
          <tr><td>P50</td><td>58万</td><td><input type="number" value={p50} onChange={e => setP50(e.target.value)} min={50} max={80} style={{ width: 70 }} /> 万</td><td>58-65万</td><td className="up">+6.9%</td></tr>
          <tr><td>P75</td><td>75万</td><td>82万</td><td>76-86万</td><td className="up">+9.3%</td></tr>
        </table>
        <div style={{ marginTop: 10, background: '#f7f9fc', borderRadius: 10, padding: 12 }}>
          <b style={{ fontSize: 13 }}>🤖 AI 依据</b>
          <Hint style={{ marginTop: 5 }}>数据源：猎聘/Boss直聘/智联 近 90 天（样本 137 条，面议估 22%）· 趋势 +4.1% · 稀缺性系数 1.15。模拟方向持续供不应求，建议 P50 上调至 62 万。⚠️ 样本量中、置信度中，建议与猎头报告交叉验证。</Hint>
        </div>
        <Hint style={{ marginTop: 8 }}>影响预览：团队 3 名模拟工程师按新带宽定薪/调薪，年度成本 <b className="up">+约 15 万（+2.1%）</b>。</Hint>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Btn primary onClick={approve}>同意并固化</Btn>
          <Btn onClick={reject}>驳回（附理由）</Btn>
          <Btn onClick={() => toast('已按新 P50 重新生成影响预览（原型演示）')}>调整后重新测算</Btn>
        </div>
      </Card>
    </>
  )
}

// ── F4 调薪审批 ──
export function RaiseApprovalPage({ act, toast }) {
  const [step, setStep] = useState(2)
  const [optExtra, setOptExtra] = useState(false)
  const approve = () => {
    setStep(3)
    act('A-102', 'approved', '+12% 已通过' + (optExtra ? ' · 期权+0.1%' : ''))
    toast('调薪已通过' + (optExtra ? '，含期权加授 0.1%' : '') + '（原型演示）')
  }
  const reject = () => { setStep(3); act('A-102', 'rejected'); toast('已驳回，将通知发起人补充说明（原型演示）') }
  return (
    <>
      <Card><Stepper steps={['① 发起（绩效/留才）', '② AI 建议', '③ 创始人审批', '④ 生效']} current={step} /></Card>
      <Card title={<>调薪申请 · 王**（模拟IC设计 P5）<Chip kind="warn">留才预警</Chip><Chip kind="info">A-102</Chip></>}>
        <div className="grid g3" style={{ marginBottom: 10 }}>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">当前年薪</div><div className="num">58万</div><div className="sub flat">带宽 P18（偏低）</div></div>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">绩效</div><div className="num" style={{ color: 'var(--ok)' }}>S</div><div className="sub flat">连续 2 个周期 S</div></div>
          <div className="card kpi" style={{ margin: 0 }}><div className="label">AI 建议</div><div className="num" style={{ color: 'var(--accent)' }}>+12%</div><div className="sub flat">65万 ≈ 带宽 P50</div></div>
        </div>
        <div style={{ background: '#f7f9fc', borderRadius: 10, padding: 12 }}>
          <b style={{ fontSize: 13 }}>🤖 AI 建议依据</b>
          <Hint style={{ marginTop: 5 }}>① 薪酬分位 P18 低于带宽下限，同类岗位中垫底；② 绩效 S + 模拟方向稀缺（系数 1.15）；③ 已在留才预警名单（见总览）。建议调至 P50（65万，+12%），并评估期权加授 0.1% 作为长期绑定。</Hint>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={optExtra} onChange={e => setOptExtra(e.target.checked)} id="opt-extra" />
          <label style={{ fontSize: 13 }} htmlFor="opt-extra">同时加授期权 0.1%（等值 ≈ 3.4 万/年，按 B 轮估值模拟）</label>
        </div>
        <Hint style={{ marginTop: 10 }}>影响测算：薪酬总额 <b>+0.5%</b> · 团队中位数不变 · 带宽穿透率 4.2% → <b>4.6%</b>（仍健康）</Hint>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Btn primary onClick={approve}>同意调薪</Btn>
          <Btn onClick={reject}>驳回（附理由）</Btn>
          <Btn onClick={() => toast('已发起与 CTO 的补充沟通（原型演示）')}>需补充信息</Btn>
        </div>
      </Card>
    </>
  )
}

// ── F2 Offer 审批（真实数据优先，无真实审批时回退演示）──
export function OfferApprovalPage({ approvals, act, toast }) {
  const [step, setStep] = useState(2)
  const real = approvals?.find(a => a.type === 'offer' && a.ref && a.status === 'pending')
    || approvals?.find(a => a.type === 'offer' && a.ref && a.ref_type === 'candidate')
  // 真实 Offer 审批
  if (real) {
    const c = real.ref
    const approve = () => {
      const comment = prompt('审批意见（可选）：', '带宽内，同意') || ''
      act(real.id, 'approved', real.key, comment)
      toast('已同意 Offer，候选人状态已更新')
    }
    const reject = () => {
      const comment = prompt('驳回理由：') || ''
      act(real.id, 'rejected', undefined, comment)
      toast('已驳回')
    }
    return (
      <>
        <Card><Stepper steps={['① 招聘需求', '② AI 对标建议', '③ 创始人审批', '④ 发出 Offer']} current={real.status === 'pending' ? 2 : 3} /></Card>
        <Card title={<>{real.title} <Chip kind="info">{real.id}</Chip></>}>
          <div className="grid g3" style={{ marginBottom: 10 }}>
            <div className="card kpi" style={{ margin: 0 }}><div className="label">候选人</div><div className="num" style={{ fontSize: 20 }}>{c.name}</div><div className="sub flat">{real.summary}</div></div>
            <div className="card kpi" style={{ margin: 0 }}><div className="label">Offer 现金</div><div className="num" style={{ fontSize: 20, color: '#d97706' }}>¥{c.offer_amount?.toLocaleString('zh-CN')}/月</div><div className="sub flat">申请：{real.key}</div></div>
            <div className="card kpi" style={{ margin: 0 }}><div className="label">审批状态</div><div className="num" style={{ fontSize: 18, color: real.status === 'approved' ? 'var(--ok)' : real.status === 'rejected' ? '#dc2626' : '#f59e0b' }}>{real.status === 'approved' ? '✅ 已通过' : real.status === 'rejected' ? '⛔ 已驳回' : '待审批'}</div><div className="sub flat">发起人：{real.who}</div></div>
          </div>
          {real.status !== 'pending' && (
            <Hint style={{ marginBottom: 10 }}>审批人：{real.action_by || '—'} · {real.action_at || ''}{real.comment ? ` · 意见：${real.comment}` : ''}</Hint>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {real.status === 'pending' ? (
              <>
                <Btn primary onClick={demoApprove}>同意发出 Offer</Btn>
                <Btn onClick={reject}>驳回（附理由）</Btn>
              </>
            ) : <Btn onClick={() => toast('该审批已处理完毕')}>返回</Btn>}
          </div>
        </Card>
      </>
    )
  }
  // 演示回退
  const demoApprove = () => { setStep(3); act('A-104', 'approved', '总包 95万 · 已同意发出'); toast('已同意发出 Offer（原型演示）') }
  const demoReject = () => { setStep(3); act('A-104', 'rejected'); toast('已驳回（原型演示）') }
  return (
    <>
      <Card><Stepper steps={['① 招聘需求', '② AI 对标建议', '③ 创始人审批', '④ 发出 Offer']} current={step} /></Card>
      <Card title={<>Offer 建议 · 周*（数字后端 P6）<Chip kind="info">A-104</Chip></>}>
        <Hint style={{ marginBottom: 8 }}>候选人画像：7 年经验 · HBM 接口稀缺技能（稀缺性高）· 3 次流片 · 现司（某大厂）总包 88 万</Hint>
        <div className="offer-split">
          <div className="os"><div className="t">现金年薪</div><div className="v">68 万</div><div className="t">带宽 P72 位置</div></div>
          <div className="os"><div className="t">期权 0.4%</div><div className="v">≈ 27 万</div><div className="t">B 轮估值 · 4 年归属</div></div>
        </div>
        <Hint>总包：<b style={{ color: 'var(--accent)' }}>95 万</b>（现金 68 + 期权 27）· 高于现司总包 +8%，现金部分略低于 P75（82万）阈值，未触发强制升级。</Hint>
        <div style={{ marginTop: 10, background: '#f7f9fc', borderRadius: 10, padding: 12 }}>
          <b style={{ fontSize: 13 }}>🤖 AI 建议</b>
          <Hint style={{ marginTop: 5 }}>HBM 接口方向招聘周期 3-4 个月，建议现金压至 P70（66万）以留调薪空间，期权维持 0.4%。若候选人坚持 95 万总包，可接受（带宽 P75 内）。</Hint>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Btn primary onClick={demoApprove}>同意发出 Offer</Btn>
          <Btn onClick={() => toast('已保存调整：现金 66万 / 期权 0.4%，等待 HR 重新生成（原型演示）')}>调整总包</Btn>
          <Btn onClick={demoReject}>驳回</Btn>
        </div>
      </Card>
    </>
  )
}
