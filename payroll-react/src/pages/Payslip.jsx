import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Modal } from '../components/ui.jsx'
import { getPayslipMe } from '../api.js'

export default function Payslip({ goto, backendUp, user, toast }) {
  const [data, setData] = useState(undefined)
  const [modal, setModal] = useState(false)
  const [text, setText] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const d = await getPayslipMe()
        if (alive) setData(d)
      } catch { if (alive) setData(null) }
    })()
    return () => { alive = false }
  }, [backendUp])

  if (data === undefined) return <Card><Hint>薪酬单加载中…</Hint></Card>
  if (!data) return <Card><Hint>{backendUp ? '未关联员工档案，或该月没有工资单。创始人账号默认不绑定员工。' : '后端未连接'}</Hint></Card>

  const emp = data.employee
  const items = data.items || []
  const net = data.net
  const aiNote = data.ai_note
  const option = data.option || null
  const status = data.status === 'paid' ? ['ok', '已发放'] : data.status === 'submitted' ? ['info', '已锁定'] : ['warn', '预览']

  return (
    <>
      <Card>
        <div className="payslip-head">
          <div className="avatar">{(emp.name || '?').slice(0, 1)}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{emp.name} · {emp.job_family}（{emp.grade}）</div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>{data?.period || '—'} · 仅自己可见 · <Chip kind={status[0]}>{status[1]}</Chip>{data.live && <span className="chip warn" style={{ marginLeft: 6 }}>实时预览，非付款凭证</span>}</div>
          </div>
        </div>
        <table className="money-table">
          <tbody>
            {items.map(it => <tr key={it.label}><td>{it.label}</td><td>{it.value}</td></tr>)}
            <tr className="total-row"><td>实发工资</td><td>{net}</td></tr>
          </tbody>
        </table>
        <div style={{ marginTop: 12, background: '#f7f9fc', borderRadius: 10, padding: 12 }}>
          <b style={{ fontSize: 13 }}>🤖 AI 解读</b>
          <Hint style={{ marginTop: 5 }}>{aiNote}</Hint>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Btn onClick={() => goto('copilot')}>问 AI：为什么扣了这么多税？</Btn>
          <Btn primary onClick={() => setModal(true)}>有疑问？申诉给 HR</Btn>
        </div>
      </Card>

      {option && (
        <Card title={<>我的期权 <Chip kind="info">{option.vested || '台账'}</Chip></>}>
          <Hint>授予：{((option.granted || 0) / 10000).toFixed(2)} 万股{option.strike != null ? ` · 行权价 ${option.strike} 元` : ''}</Hint>
          {user?.role !== 'emp' && (
            <div style={{ marginTop: 10 }}><Btn sm onClick={() => goto('option')}>用模拟器看看完整价值</Btn></div>
          )}
        </Card>
      )}

      {modal && (
        <Modal onClose={() => setModal(false)}>
          <div className="modal">
            <h3>薪酬申诉</h3>
            <p className="hint" style={{ marginBottom: 8 }}>提交后 HR 将在 48 小时内人工响应；申诉不影响已发放金额。</p>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="请描述疑问，例如：6 月社保扣款比上月多了 210 元…" />
            <div className="row">
              <Btn onClick={() => setModal(false)}>取消</Btn>
              <Btn primary onClick={() => { setModal(false); setText(''); (toast || (() => {}))('申诉通道尚未开放，请直接联系 HR') }}>提交申诉</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
