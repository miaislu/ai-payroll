import { useEffect, useRef, useState } from 'react'
import { Card, Chip, Hint, Btn } from '../components/ui.jsx'
import { askCopilot, clearCopilot, getCopilotConfig } from '../api.js'

export default function Copilot({ toast, backendUp }) {
  const [msgs, setMsgs] = useState([{ role: 'ai', text: '你好，我是人力助手。可以问我制度、社保个税、加班、招聘定薪、考勤等问题（支持多轮追问，回答都会附上来源）。' }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [config, setConfig] = useState(null)
  const [allowExternal, setAllowExternal] = useState(false)
  const box = useRef(null)
  const sessionId = useRef('s-' + Date.now() + '-' + Math.random().toString(36).slice(2))

  const newSession = () => {
    const oldSession = sessionId.current
    sessionId.current = 's-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    setMsgs([{ role: 'ai', text: '已开启新会话。可以继续问我人事/薪酬/政策问题（多轮记忆已清空）。' }])
    if (backendUp) clearCopilot(oldSession).catch(() => {})
  }

  useEffect(() => {
    if (!backendUp) return
    getCopilotConfig()
      .then(c => setConfig(c || null))
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
      if (!backendUp) throw new Error('后端不可用')
      const r = await askCopilot(q, sessionId.current, allowExternal)
      setBusy(false)
      return push('ai', r.answer + (r.source ? '\n\n' + r.source : ''), r.engine === 'llm' ? '外部 LLM（已脱敏）' : '本地知识库')
    } catch (error) {
      setBusy(false)
      push('ai', `暂时无法取得可靠回答：${error.message}。请稍后重试或通过公司现有渠道联系 HR。`, '请求失败')
      toast('人力助手请求失败')
    }
  }
  const send = () => { const q = input.trim(); if (!q || busy) return; setInput(''); ask(q) }

  return (
    <Card title={<>人力助手
      {config?.external_enabled ? <Chip kind="warn">本地知识库 · 外部 LLM 可逐次授权</Chip> : <Chip kind="ok">本地知识库</Chip>}
    </>}>
      <div className="chip-row">
        <Btn sm onClick={() => ask('为什么社保参数必须按账期核验？')}>社保参数核验</Btn>
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
      {config?.external_enabled && <label className="hint" style={{ display: 'block', marginTop: 8 }}>
        <input type="checkbox" checked={allowExternal} onChange={e => setAllowExternal(e.target.checked)} /> 允许本次会话将每个问题及近期上下文脱敏后发送给已配置的外部 LLM
      </label>}
      <Hint style={{ marginTop: 8 }}>默认仅使用本地知识库；外部发送需管理员开关与用户显式同意。系统不会自动创建 HR 工单。</Hint>
    </Card>
  )
}
