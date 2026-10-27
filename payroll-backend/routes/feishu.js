import { Router } from 'express'
import path from 'node:path'
import { db, DB_PATH, audit } from '../db.js'
import { auth } from '../lib/auth.js'
import { FeishuSync } from '../lib/feishu_sync.js'

export const feishu = Router()
const sync = new FeishuSync(db, process.env.FEISHU_CONFIG_FILE || path.join(path.dirname(DB_PATH), 'feishu-config.json'))
feishu.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
feishu.get('/config', (req, res) => res.json(sync.status()))
feishu.put('/config', auth(['founder']), (req, res) => {
  const status = sync.saveLink(req.body, req.user.id)
  audit(req.user, 'configure', 'feishu', null, null, { configured: status.configured })
  res.json(status)
})
feishu.post('/resolve-link', auth(['founder']), async (req, res) => res.json(await sync.resolveLink(req.body, req.user.id)))
feishu.post('/probe', async (req, res) => res.json(await sync.probe()))
feishu.post('/initialize-fields', auth(['founder']), async (req, res) => {
  const result = await sync.initialize()
  audit(req.user, 'initialize_fields', 'feishu', null)
  res.json(result)
})
feishu.post('/preview', async (req, res) => res.json(await sync.preview(req.body, req.user.id)))
feishu.post('/push', async (req, res) => res.json(await sync.push(req.body.token, req.user.id, result => {
  audit(req.user, result.ok ? 'sync_success' : 'sync_failed', 'feishu_candidate', result.id, null, result)
})))
