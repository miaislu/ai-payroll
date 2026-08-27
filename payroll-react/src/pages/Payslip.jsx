import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn } from '../components/ui.jsx'
import { getPayslipMe } from '../api.js'

export default function Payslip({ goto, backendUp }) {
  const [data, setData] = useState(null)
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

  const emp = data?.employee || { name: '张三', grade: 'P5', job_family: '模拟IC设计工程师' }
  const items = data?.items || [
    { label: '基本工资', value: '25,000' }, { label: '绩效奖金', value: '8,000' }, { label: '加班费', value: '0' },
    { label: '社保（个人）', value: '-2,450' }, { label: '公积金（个人）', value: '-1,500' }, { label: '个人所得税', value: '-2,310' }
  ]
  const net = data?.net || '30,690'
  const aiNote = data?.ai_note || '本月社保基数按 2025 年新基数调整，个人部分 +210 元；个税同比 -180 元（因专项附加扣除更新）。实发与 5 月基本持平。'
  const option = data?.option || { granted: 100000, strike: 0.5, vested: '25%', est_value: '≈ 52.5 万（未扣税）' }

  return (
    <>
      <Card>
        <div className="payslip-head">
          <div className="avatar">张</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{emp.name} · {emp.job_family}（{emp.grade}）</div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>{data?.period || '2025-06'} · 仅自己可见 · <Chip kind="ok">已发放</Chip>{backendUp && <span className="chip info" style={{ marginLeft: 6 }}>后端实时计算</span>}</div>
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

      <Card title={<>我的期权 <Chip kind="info">已归属 {option.vested}</Chip></>}>
        <Hint>授予：{(option.granted / 10000).toFixed(0)} 万股 · 行权价 {option.strike} 元 · 4 年归属（1 年 cliff）</Hint>
        <Hint style={{ marginTop: 6 }}>最新估值（B 轮）：8 元/股。当前行权价值：<b style={{ color: 'var(--accent)' }}>{option.est_value}</b>（未扣税）</Hint>
        <div style={{ marginTop: 10 }}><Btn sm onClick={() => goto('option')}>用模拟器看看完整价值</Btn></div>
      </Card>

      {modal && (
        <div id="modal-bg" className="show" onClick={e => e.target.id === 'modal-bg' && setModal(false)}>
          <div className="modal">
            <h3>薪酬申诉</h3>
            <p className="hint" style={{ marginBottom: 8 }}>提交后 HR 将在 48 小时内人工响应；申诉不影响已发放金额。</p>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="请描述疑问，例如：6 月社保扣款比上月多了 210 元…" />
            <div className="row">
              <Btn onClick={() => setModal(false)}>取消</Btn>
              <Btn primary onClick={() => { setModal(false); setText('') }}>提交申诉</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
