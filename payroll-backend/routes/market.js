import { Router } from 'express'
import { audit, db, inTransaction } from '../db.js'
import { auth } from '../lib/auth.js'
import { nextApprovalId } from '../lib/approvals.js'
import { bandFromSamples, normalizeSample, parseCsv } from '../lib/market.js'

export const market = Router()

market.get('/market/summary', auth(['hr', 'founder']), (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM market_samples').get().c
  const last = db.prepare('SELECT * FROM market_ingests ORDER BY id DESC LIMIT 1').get() || null
  const byDir = db.prepare('SELECT direction, COUNT(*) n, ROUND(AVG(annual_cash_wan),1) avg_wan FROM market_samples GROUP BY direction ORDER BY n DESC').all()
  res.json({
    total,
    last,
    by_direction: byDir,
    scrape_enabled: false,
    note: '仅支持 CSV/JSON 导入。猎聘/Boss 等平台实时抓取未开通。'
  })
})

market.get('/market/samples', auth(['hr', 'founder']), (req, res) => {
  const { direction, city, exp } = req.query
  let sql = 'SELECT * FROM market_samples WHERE 1=1'
  const args = []
  if (direction) { sql += ' AND direction=?'; args.push(direction) }
  if (city) { sql += ' AND city=?'; args.push(city) }
  if (exp) { sql += ' AND exp_band=?'; args.push(exp) }
  sql += ' ORDER BY id DESC LIMIT 500'
  res.json(db.prepare(sql).all(...args))
})

market.post('/market/ingest', auth(['hr', 'founder']), (req, res) => {
  const b = req.body || {}
  let raw = Array.isArray(b.samples) ? b.samples : []
  if (!raw.length && b.csv) raw = parseCsv(b.csv)
  if (!raw.length) return res.status(400).json({ error: '请提供 samples 数组或 csv 文本' })
  if (raw.length > 500) return res.status(400).json({ error: '单次最多导入 500 条' })
  const samples = raw.map(normalizeSample).filter(Boolean)
  if (!samples.length) return res.status(400).json({ error: '没有合法样本（需要 direction + annual_cash_wan）' })
  const source = String(b.source || (b.csv ? 'import:csv' : 'import:json')).slice(0, 80)
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  let ingestId
  inTransaction(() => {
    const insI = db.prepare('INSERT INTO market_ingests(source,sample_count,created_by,note,created_at) VALUES(?,?,?,?,?)')
    ingestId = insI.run(source, samples.length, req.user.name, String(b.note || '').slice(0, 200), now).lastInsertRowid
    const ins = db.prepare('INSERT INTO market_samples(ingest_id,direction,city,exp_band,company_type,annual_cash_wan,source,collected_at,title) VALUES(?,?,?,?,?,?,?,?,?)')
    for (const s of samples) ins.run(ingestId, s.direction, s.city, s.exp_band, s.company_type, s.annual_cash_wan, s.source, s.collected_at, s.title)
    audit(req.user, 'ingest', 'market', ingestId, null, { count: samples.length, source })
  })
  res.json({ ok: true, ingest_id: ingestId, imported: samples.length, skipped: raw.length - samples.length })
})

market.post('/market/draft-band', auth(['hr', 'founder']), (req, res) => {
  const direction = String(req.body?.direction || '').trim()
  if (!direction) return res.status(400).json({ error: '缺少岗位方向' })
  const current = db.prepare('SELECT * FROM benchmarks WHERE direction=?').get(direction) || null
  const pending = db.prepare("SELECT id FROM approvals WHERE type='band' AND status='pending' AND json_extract(payload_json, '$.direction')=?").get(direction)
  if (pending) return res.status(409).json({ error: `该方向已有待审带宽 ${pending.id}` })
  const samples = db.prepare("SELECT * FROM market_samples WHERE direction=? AND city='上海' AND exp_band='3-5年' AND company_type='Fabless'").all(direction)
  if (samples.length < 5) return res.status(409).json({ error: `上海·3-5年·Fabless 同口径样本不足（当前 ${samples.length} 条，至少 5 条）。请先导入匹配样本。` })
  const band = bandFromSamples(samples)
  const from = current ? { p25: current.p25, p50: current.p50, p75: current.p75 } : null
  const to = { p25: band.p25, p50: band.p50, p75: band.p75 }
  const payload = { kind: 'band', direction, city: '上海', exp: '3-5年', company_type: 'Fabless', from, to, sample: band.n, source: `market_samples cohort 上海·3-5年·Fabless (${band.n} 条)` }
  const id = nextApprovalId()
  const pct = from?.p50 ? Math.round((to.p50 - from.p50) / from.p50 * 1000) / 10 : null
  const key = from ? `P50 ${from.p50}万 → ${to.p50}万（${pct >= 0 ? '+' : ''}${pct}%）` : `新建 P50 ${to.p50}万`
  inTransaction(() => {
    db.prepare('INSERT INTO approvals(id,type,title,who,key,summary,status,page,payload_json,created_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, 'band', `带宽刷新 · ${direction}（上海 3-5年）`, `${req.user.name} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, key, `导入样本 ${band.n} 条 · 不做平台抓取`, 'pending', 'band-approval', JSON.stringify(payload), req.user.id)
    audit(req.user, 'create', 'approval', id, null, payload)
  })
  res.json({ ok: true, id, from, to, sample: band.n, key })
})
