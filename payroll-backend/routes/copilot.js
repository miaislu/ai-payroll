import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { audit, db } from '../db.js'
import { auth } from '../lib/auth.js'
import { chat, llmConfigured, LLM_MODEL, LLM_BASE } from '../lib/llm.js'
import { retrieve, buildContext, contextSources, COPILOT_SYSTEM } from '../lib/rag.js'
import { detectCity, cityContext, KNOWN_CITIES } from '../lib/city_policies.js'
import { redactForExternalLlm } from '../lib/pii.js'

export const copilot = Router()

const KB = [
  { k: ['试用期', '社保'], a: '试用期工资和参保规则需要同时满足劳动合同、当地当期最低工资与社保口径。系统内城市参数是历史预览资料，正式计算前必须由薪税负责人按账期核验；当前未核验参数会阻断月结。', s: '参考：《劳动合同法》第 20 条；城市政策文件须按账期另行核验' },
  { k: ['加班'], a: '工作日延长工时、休息日且不能补休、法定休假日安排工作的工资支付倍数分别为 1.5、2、3。具体加班工资基数还应按有效劳动合同、集体合同及当地规则核验。', s: '参考：《劳动法》第 44 条；工资基数口径须按当地当期规则核验' },
  { k: ['递延', '101号', '期权'], a: '非上市公司股权激励在满足适用范围、备案和持有等条件时可能适用递延纳税。是否符合条件、纳税时点与所得类型必须由税务负责人结合当前有效文件和具体方案确认，系统不自动作税务结论。', s: '历史索引：财税〔2016〕101 号；使用前须到官方渠道核验现行状态' },
  { k: ['补贴', '人才'], a: '人才补贴的对象、金额、窗口期和材料会随城市、园区及年度变化。本系统没有实时政务政策库，不能判断可申领资格或自动生成正式申报材料；请以所在地政府当期官方通知为准。', s: '无实时政策数据；请查询所在地政府官方渠道' },
  { k: ['税', '个税'], a: '工资薪金通常按累计预扣法计算，但扣除项目、适用条件和政策有效期必须按纳税年度及个人申报信息核验。系统测算仅供复核，不替代税务申报结果。', s: '来源：个人所得税法及配套预扣申报规则（正式使用前按纳税年度核验）' },
  { k: ['离职', '结算'], a: '离职结算可能涉及当月工资、未休年假工资及经济补偿或赔偿；是否支付、计算年限和基数取决于解除原因与证据。社保停缴情形也应按参保地当期规则办理，请由 HR/法务复核后录入明确金额。', s: '参考：《劳动合同法》第 46-48 条；当地社保办理规则须另行核验' },
  { k: ['招聘', '猎头', '渠道'], a: '系统中的招聘成本可按渠道固定费、猎头成功费、内推奖金和校招差旅归集；人均招聘成本可用期间招聘费用除以同期实际入职人数。费率和目标值必须来自已导入合同、预算或公司制度，系统没有内置行业目标。', s: '系统计算口径说明；无内置行业基准' },
  { k: ['编制', '预算', '人力成本', '预测'], a: '人力成本预测按编制计划和员工有效薪酬条款计算，包含应发工资、按城市政策计算的公司社保公积金和期权摊销。预测按组织层级聚合；预算差异仅作提示，不会自动冻结招聘或调薪。', s: '系统计算口径说明' },
  { k: ['公司成本', '口径', '期权摊销'], a: '公司口径薪酬成本包含应发工资、按员工城市与账期政策计算的公司社保公积金，以及从授予月开始按归属期摊销的期权成本。费率来自政策配置文件，未核验时只提供预览并阻断月结。', s: '系统计算口径说明；城市政策须按账期核验' },
  { k: ['Offer', '定薪', '带宽'], a: 'Offer 定薪可引用已导入的岗位带宽 P25/P50/P75，并结合城市、经验和公司类型筛选；超带宽申请需进入审批。系统不内置现金与期权的推荐换算比例，最终方案应依据已批准的公司制度。', s: '系统流程与已导入对标数据' }
]

const SESSION_TTL = 60 * 60 * 1000
const MAX_HISTORY = 10
const MAX_SESSIONS = 1000
const externalLlmEnabled = () => process.env.COPILOT_EXTERNAL_LLM === 'true' && llmConfigured()

function sessionKey(userId, sid) { return `${userId}:${sid}` }

function parseMessages(raw) {
  try {
    const list = JSON.parse(raw || '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL
  db.prepare('DELETE FROM copilot_sessions WHERE updated_at < ?').run(cutoff)
  const n = db.prepare('SELECT COUNT(*) c FROM copilot_sessions').get().c
  if (n <= MAX_SESSIONS) return
  const extra = n - MAX_SESSIONS
  db.prepare('DELETE FROM copilot_sessions WHERE session_key IN (SELECT session_key FROM copilot_sessions ORDER BY updated_at ASC LIMIT ?)').run(extra)
}

function loadSession(sid, userId) {
  const key = sessionKey(userId, sid)
  const row = db.prepare('SELECT messages_json FROM copilot_sessions WHERE session_key=?').get(key)
  return parseMessages(row?.messages_json)
}

function saveSession(sid, userId, messages) {
  const key = sessionKey(userId, sid)
  db.prepare(`INSERT INTO copilot_sessions(session_key, messages_json, updated_at) VALUES(?,?,?)
    ON CONFLICT(session_key) DO UPDATE SET messages_json=excluded.messages_json, updated_at=excluded.updated_at`)
    .run(key, JSON.stringify(messages), Date.now())
}

setInterval(pruneSessions, 10 * 60 * 1000).unref()

copilot.get('/copilot/config', auth(), (req, res) => {
  res.json({ configured: llmConfigured(), external_enabled: externalLlmEnabled(), engine: externalLlmEnabled() ? 'opt_in_llm' : 'kb', model: externalLlmEnabled() ? LLM_MODEL : null, base: externalLlmEnabled() ? LLM_BASE : null, cities: KNOWN_CITIES.length, retrieval: 'hybrid(tfidf-cosine+synonym+keyword)' })
})

copilot.get('/copilot/retrieval', auth(), (req, res) => {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: '缺少 q' })
  res.json({ question: q, hits: retrieve(q, 5).map(x => ({ id: x.c.id, title: x.c.title, score: Math.round(x.s * 100) / 100, kw: x.kw, cos: Math.round(x.cos * 1000) / 1000 })) })
})

copilot.post('/copilot/clear', auth(), (req, res) => {
  const sid = (req.body?.sessionId || '').trim()
  if (sid) db.prepare('DELETE FROM copilot_sessions WHERE session_key=?').run(sessionKey(req.user.id, sid))
  res.json({ ok: true })
})

copilot.post('/copilot/ask', auth(), async (req, res) => {
  const q = (req.body?.question || '').trim()
  if (!q) return res.status(400).json({ error: 'question 不能为空' })
  if (q.length > 4000) return res.status(400).json({ error: 'question 不得超过 4000 字' })
  const requestedSid = String(req.body?.sessionId || '').trim()
  if (requestedSid && !/^[A-Za-z0-9_-]{1,100}$/.test(requestedSid)) return res.status(400).json({ error: 'sessionId 不合法' })
  pruneSessions()
  const sid = requestedSid || ('s-' + randomUUID())
  const messages = loadSession(sid, req.user.id)
  messages.push({ role: 'user', content: q })
  if (messages.length > MAX_HISTORY * 2) messages.splice(0, messages.length - MAX_HISTORY * 2)

  const city = detectCity(q)
  const cityCtx = city ? cityContext(city) : ''

  const allowExternal = req.body?.allow_external === true
  if (externalLlmEnabled() && allowExternal && (retrieve(q).length > 0 || city)) {
    const scored = retrieve(q)
    const ctxBlock = [cityCtx, buildContext(scored)].filter(Boolean).join('\n\n')
    try {
      const history = messages.slice(0, -1).slice(-MAX_HISTORY)
      const redactedHistory = history.map(m => ({ role: m.role, content: redactForExternalLlm(m.content).text }))
      const redactedQuestion = redactForExternalLlm(q)
      audit(req.user, 'external_llm_request', 'copilot_session', sid, null, {
        model: LLM_MODEL,
        question_length: q.length,
        redaction_kinds: redactedQuestion.kinds,
        history_items: redactedHistory.length
      })
      const answer = await chat([
        { role: 'system', content: COPILOT_SYSTEM },
        ...redactedHistory,
        { role: 'user', content: `【参考上下文】\n${ctxBlock}\n\n【用户问题】\n${redactedQuestion.text}\n\n请回答（附来源）。` }
      ])
      messages.push({ role: 'assistant', content: answer })
      saveSession(sid, req.user.id, messages)
      return res.json({ sessionId: sid, answer, source: [cityCtx.includes('来源') ? cityCtx.match(/来源：(\S+)/)?.[1] : '', ...contextSources(scored)].filter(Boolean).join('；'), engine: 'llm', escalated: false })
    } catch (e) {
      console.warn('[copilot] LLM 调用失败，降级规则 KB:', e.message)
    }
  }

  const scoredKb = KB.map(e => ({ e, s: e.k.reduce((acc, kw) => acc + (q.includes(kw) ? 1 : 0), 0) }))
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s)[0]
  if (scoredKb) {
    messages.push({ role: 'assistant', content: scoredKb.e.a })
    saveSession(sid, req.user.id, messages)
    return res.json({ sessionId: sid, answer: scoredKb.e.a, source: scoredKb.e.s, engine: 'kb', escalated: false })
  }
  const esc = '这个问题需要人工结合具体情况判断。系统未创建 HR 工单，请通过公司现有渠道联系 HR。\n\n提示：也可尝试“试用期/社保”“加班”“期权递延”“离职结算”等关键词。'
  messages.push({ role: 'assistant', content: esc })
  saveSession(sid, req.user.id, messages)
  res.json({ sessionId: sid, answer: esc, source: null, engine: 'kb', escalated: false, needs_human: true })
})
