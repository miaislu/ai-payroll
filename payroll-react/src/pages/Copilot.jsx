import { useEffect, useRef, useState } from 'react'
import { Card, Chip, Hint, Btn } from '../components/ui.jsx'
import { KB } from '../data.js'
import { askCopilot } from '../api.js'

export default function Copilot({ toast, backendUp }) {
  const [msgs, setMsgs] = useState([{ role: 'ai', text: '你好，我是 AI 薪酬助手。可以问我制度、政策、薪酬计算口径等问题（支持多轮追问，回答都会附上来源）。' }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState(null) // null | 'llm' | 'kb'
  const box = useRef(null)
  const sessionId = useRef('s-' + Date.now() + '-' + Math.random().toString(36).slice(2))

  const newSession = () => {
    sessionId.current = 's-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    setMsgs([{ role: 'ai', text: '已开启新会话。可以继续问我薪酬/政策问题（多轮记忆已清空）。' }])
    if (backendUp) fetch('/api/copilot/clear', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sessionStorage.getItem('payroll_token') || '') }, body: JSON.stringify({ sessionId: sessionId.current }) }).catch(() => {})
  }

  useEffect(() => {
    if (!backendUp) return
    fetch('/api/copilot/config', { headers: { Authorization: 'Bearer ' + (sessionStorage.getItem('payroll_token') || '') } })
      .then(r => r.ok ? r.json() : null)
      .then(c => c && setEngine(c.engine === 'llm' ? 'llm' : 'kb'))
      .catch(() => {})
  }, [backendUp])

  const push = (role, text, tag) => {
    setMsgs(m => [...m, { role, text, tag }])
    setTimeout(() => box.current && (box.current.scrollTop = box.current.scrollHeight), 30)
  }
  const ask = async q => {
    push('user', q)
    setBusy(true)
    try {
      if (backendUp) {
        const r = await askCopilot(q, sessionId.current)
        setBusy(false)
        return push('ai', r.answer + (r.source ? '\n\n' + r.source : ''), r.engine === 'llm' ? 'LLM' : '知识库')
      }
    } catch { /* 落本地 KB */ }
    setBusy(false)
    const hit = KB.find(item => item.k.every(w => q.includes(w)))
    if (hit) push('ai', hit.a + '\n\n' + hit.s, '知识库')
    else { push('ai', '这个问题需要结合具体情况，已转给 HR 人工处理（预计 2 小时内回复）。\n\n提示：可尝试"试用期/社保""加班""期权递延""离职结算"等关键词。', '转人工'); toast('已转人工工单（本地演示）') }
  }
  const send = () => { const q = input.trim(); if (!q || busy) return; setInput(''); ask(q) }

  return (
    <Card title={<>AI 薪酬助手
      {engine === 'llm' ? <Chip kind="ok">● LLM 引擎 · 多轮记忆</Chip> : engine === 'kb' ? <Chip kind="warn">知识库引擎（未配置 LLM key）</Chip> : <Chip kind="gray">知识库：本地 6 条</Chip>}
    </>}>
      <div className="chip-row">
        <Btn sm onClick={() => ask('上海 2025 社保基数下限是多少？')}>上海社保基数</Btn>
        <Btn sm onClick={() => ask('加班费倍数怎么算？')}>加班费</Btn>
        <Btn sm onClick={() => ask('期权递延纳税需要什么条件？')}>期权递延纳税</Btn>
        <Btn sm onClick={() => ask('苏州的社保基数是多少？')}>苏州（未收录城市）</Btn>
        <Btn sm onClick={newSession}>新会话</Btn>
      </div>
      <div className="chat" ref={box}>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.tag && m.role === 'ai' && <span className="chip info" style={{ marginBottom: 6, display: 'inline-block' }}>{m.tag}</span>}
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
          </div>
        ))}
        {busy && <div className="msg ai" style={{ color: 'var(--muted)' }}>思考中…</div>}
      </div>
      <div className="chat-input">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="输入问题，例如：离职当月社保怎么算？" />
        <Btn primary onClick={send} disabled={busy}>发送</Btn>
      </div>
      <Hint style={{ marginTop: 8 }}>RAG 知识库 12 条政策/制度 · LLM 回答附来源且禁止编造；上下文不足自动转人工</Hint>
    </Card>
  )
}
