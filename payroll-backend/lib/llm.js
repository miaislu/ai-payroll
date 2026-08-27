// LLM 客户端：OpenAI 兼容 chat/completions，默认 DeepSeek，可用 .env 切换任意兼容端点
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 轻量 .env 加载（Node 无内置，避免 --env-file 兼容问题）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
try {
  const envPath = path.join(__dirname, '..', '.env')
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* 无 .env 文件则仅用环境变量 */ }

export const LLM_BASE = (process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
export const LLM_KEY = process.env.LLM_API_KEY || ''
export const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat'
export const llmConfigured = () => !!LLM_KEY

export async function chat(messages, { maxTokens = 800, temperature = 0.3, timeoutMs = 30000 } = {}) {
  if (!LLM_KEY) throw new Error('LLM_API_KEY 未配置（写入 payroll-backend/.env）')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(LLM_BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LLM_KEY },
      body: JSON.stringify({ model: LLM_MODEL, messages, temperature, max_tokens: maxTokens, stream: false }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const t = await res.text()
      throw new Error('LLM ' + res.status + ': ' + t.slice(0, 200))
    }
    const d = await res.json()
    const content = d.choices?.[0]?.message?.content
    if (!content) throw new Error('LLM 响应缺少 choices[0].message.content')
    return content
  } finally {
    clearTimeout(timer)
  }
}
