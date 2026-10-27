import { randomUUID, createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync, statSync } from 'node:fs'
import path from 'node:path'
import { FEISHU_FIELDS, FeishuClient, failFeishu, parseFeishuLink, parseFeishuTarget, schemaReport } from './feishu_client.js'
import { readProfile } from './resume_profile.js'
import { expectedSalaryLabel } from './candidate_salary.js'
import { expectedAnnualSalaryLabel } from './candidate_annual_salary.js'
import { candidateSourceToken } from './candidate_resumes.js'

const digest = value => createHash('sha256').update(value).digest('hex')
const stages = { new: '新简历', screening: '初筛', waiting: '待面试', interview: '面试中', offer: 'Offer', accepted: '已录用', hired: '已建员工档案', rejected: '已淘汰', withdrawn: '已放弃' }
const requiredKeys = FEISHU_FIELDS.filter(f => f.required).map(f => f.key)

export class FeishuSync {
  constructor(connection, configFile, clientFactory = config => new FeishuClient(config)) {
    this.db = connection; this.configFile = configFile; this.clientFactory = clientFactory
    this.previews = new Map(); this.resolutions = new Map(); this.busy = false; this.client = null; this.clientHash = ''
  }
  config() {
    if (!existsSync(this.configFile)) return null
    try { return JSON.parse(readFileSync(this.configFile, 'utf8')) }
    catch { throw failFeishu('飞书配置无法读取，请重新保存配置', 409) }
  }
  status() {
    const config = this.config()
    return { configured: Boolean(config?.app_id && config?.app_secret && config?.app_token && config?.table_id),
      app_id: config?.app_id || '', base_url: config?.base_url || '', table_id: config?.table_id || '', secret_saved: Boolean(config?.app_secret), fields: FEISHU_FIELDS }
  }
  credentials(body) {
    const appId = String(body.app_id || '').trim()
    if (!/^cli_[a-zA-Z0-9]{6,100}$/.test(appId)) throw failFeishu('App ID 格式不正确')
    const previous = this.config()
    const secret = typeof body.app_secret === 'string' && body.app_secret.trim()
      ? body.app_secret.trim() : previous?.app_id === appId ? previous.app_secret : ''
    if (!secret || secret.length > 500 || /[\r\n]/.test(secret)) throw failFeishu('请输入有效的 App Secret（更换 App ID 时须重新填写）')
    return { app_id: appId, app_secret: secret }
  }
  save(body) { return this.persist(parseFeishuTarget(body.base_url), this.credentials(body)) }
  persist(target, credentials) {
    if (this.busy) throw failFeishu('同步正在进行，请完成后再修改配置', 409)
    const config = { ...target, ...credentials }
    mkdirSync(path.dirname(this.configFile), { recursive: true, mode: 0o700 })
    const temp = `${this.configFile}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify(config), { mode: 0o600 })
    chmodSync(temp, 0o600); renameSync(temp, this.configFile)
    this.previews.clear(); this.resolutions.clear(); this.client = null
    return this.status()
  }
  async resolveLink(body, userId) {
    const link = parseFeishuLink(body.base_url), credentials = this.credentials(body)
    const client = this.clientFactory(credentials)
    const appToken = link.kind === 'wiki' ? await client.wikiBase(link.token) : link.token
    const tables = await client.tables(appToken)
    // Never silently substitute the first table for an explicit but inaccessible table.
    if (link.table_id && !tables.some(table => table.table_id === link.table_id)) throw failFeishu('链接指定的数据表不存在或应用无权访问，请检查表格授权', 409)
    for (const [key, entry] of this.resolutions) if (entry.expires < Date.now()) this.resolutions.delete(key)
    if (this.resolutions.size >= 50) this.resolutions.delete(this.resolutions.keys().next().value)
    const token = randomUUID()
    this.resolutions.set(token, { link, appToken, tables, userId, credentialsHash: digest(JSON.stringify(credentials)), expires: Date.now() + 10 * 60 * 1000 })
    return { resolution_token: token, tables, selected_table_id: link.table_id || (tables.length === 1 ? tables[0].table_id : ''), kind: link.kind }
  }
  saveLink(body, userId) {
    const link = parseFeishuLink(body.base_url)
    if (!body.resolution_token && link.kind === 'base' && link.table_id) return this.save(body)
    const entry = this.resolutions.get(body.resolution_token)
    const credentials = this.credentials(body)
    if (!entry || entry.userId !== userId || entry.expires < Date.now() || entry.link.base_url !== link.base_url
      || entry.credentialsHash !== digest(JSON.stringify(credentials))) throw failFeishu('请先点击“读取数据表”；链接或应用凭证变更后须重新读取', 409)
    const tableId = body.table_id
    if (!entry.tables.some(table => table.table_id === tableId)) throw failFeishu('请从已读取的列表中选择目标数据表')
    const url = new URL(link.base_url); url.searchParams.set('table', tableId)
    return this.persist({ app_token: entry.appToken, table_id: tableId, base_url: url.toString() }, credentials)
  }
  configuredClient() {
    const config = this.config()
    if (!config?.app_secret) throw failFeishu('请先创建飞书多维表格并保存应用配置', 409)
    const hash = digest(JSON.stringify(config))
    if (!this.client || this.clientHash !== hash) { this.client = this.clientFactory(config); this.clientHash = hash }
    return { config, hash, client: this.client, target: `${config.app_token}:${config.table_id}` }
  }
  async exclusive(fn) {
    if (this.busy) throw failFeishu('已有飞书操作正在进行，请稍后再试', 409)
    this.busy = true
    try { return await fn() } finally { this.busy = false }
  }
  async probe() {
    const { client } = this.configuredClient()
    const attachmentAccess = await client.uploadAccess?.({ forceRefresh: true }) || { state: 'unknown' }
    return { fields: schemaReport(await client.fields()), attachment_access: attachmentAccess }
  }
  async initialize() {
    return this.exclusive(async () => {
      const { client } = this.configuredClient()
      const report = schemaReport(await client.fields())
      if (report.some(f => f.state === 'wrong_type')) throw failFeishu('同名字段的类型不符合要求，请先在飞书改为所列类型', 409)
      for (const field of report.filter(f => f.state === 'missing')) {
        await client.addField(field)
        await new Promise(resolve => setTimeout(resolve, 120))
      }
      return { fields: schemaReport(await client.fields()) }
    })
  }
  selection(body) {
    if (!Array.isArray(body.candidate_ids) || !body.candidate_ids.length || body.candidate_ids.length > 20
      || body.candidate_ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw failFeishu('每次请选择 1–20 位人选')
    const allowed = new Set(FEISHU_FIELDS.filter(f => f.key !== 'attachments').map(f => f.key))
    if (!Array.isArray(body.fields) || body.fields.some(key => !allowed.has(key))) throw failFeishu('同步字段无效')
    const ids = [...new Set(body.candidate_ids)]
    const attachments = body.attachments || {}
    if (typeof attachments !== 'object' || Array.isArray(attachments)
      || Object.keys(attachments).some(id => !ids.includes(Number(id)))) throw failFeishu('附件选择不属于本次人选')
    const files = {}
    for (const id of ids) {
      const list = attachments[id] || []
      if (!Array.isArray(list) || list.length > 50 || list.some(rid => !Number.isSafeInteger(rid) || rid <= 0)) throw failFeishu('附件选择无效')
      files[id] = [...new Set(list)]
    }
    if (Object.values(files).flat().length > 50) throw failFeishu('单次最多同步 50 份附件')
    return { ids, fields: [...new Set([...requiredKeys, ...body.fields])], attachments: files }
  }
  snapshot(id, selection) {
    const candidate = this.db.prepare(`SELECT c.*,j.title requisition_title FROM candidates c LEFT JOIN job_requisitions j ON j.id=c.requisition_id WHERE c.id=?`).get(id)
    if (!candidate) throw failFeishu('所选人选已不存在，请刷新简历库', 409)
    this.db.prepare('INSERT OR IGNORE INTO feishu_candidate_keys(candidate_id,source_key) VALUES(?,?)').run(id, `hr_${randomUUID()}`)
    const sourceKey = this.db.prepare('SELECT source_key FROM feishu_candidate_keys WHERE candidate_id=?').get(id).source_key
    // Only saved profile fields are exported. Pending model results are not confirmed information.
    const profile = readProfile(candidate.profile_json)
    const textRows = (rows, fields) => (Array.isArray(rows) ? rows : []).map(row => fields.map(key => row[key] ?? '').filter(Boolean).join(' · ')).join('\n')
    const data = { source_key: sourceKey, name: candidate.name, phone: candidate.phone || '', email: candidate.email || '',
      job: candidate.requisition_title || '', salary: expectedSalaryLabel(candidate),
      salary_annual: expectedAnnualSalaryLabel(candidate),
      status: candidate.stage === 'interview' ? `第 ${candidate.current_round || 1} 轮面试中` : stages[candidate.stage] || candidate.stage,
      channel: candidate.source_channel || '', apply_date: candidate.apply_date || candidate.created_at?.slice(0, 10) || '',
      skills: profile.basic?.skills || '', education: textRows(profile.education, ['school', 'qualification', 'major', 'graduation_year', 'note']),
      work: textRows(profile.work_experience, ['company', 'title', 'start_date', 'end_date', 'note']) }
    const values = Object.fromEntries(selection.fields.filter(key => key !== 'synced_at').map(key => [key, String(data[key] ?? '')]))
    if (Object.values(values).some(value => value.length > 20000)) throw failFeishu('资料超过飞书单格安全长度，请减少经历内容后重试')
    const files = selection.attachments[id].map(rid => {
      const row = this.db.prepare('SELECT * FROM candidate_resumes WHERE id=? AND candidate_id=?').get(rid, id)
      if (!row) throw failFeishu('所选附件已不存在或不属于该人选，请重新预览', 409)
      let bytes
      try {
        if (statSync(row.file_path).size > 10 * 1024 * 1024) throw new Error('large')
        bytes = readFileSync(row.file_path)
      } catch { throw failFeishu('所选附件无法读取或超过 10MB，请重新上传', 409) }
      return { id: row.id, original_name: row.original_name, size: bytes.length, content_hash: digest(bytes) }
    })
    return { id, source_key: sourceKey, name: candidate.name, values, files,
      profile_saved: Boolean(candidate.profile_json), has_pending_parse: Boolean(candidate.resume_parsed && candidateSourceToken(candidate) !== candidate.resume_applied_hash),
      fingerprint: digest(JSON.stringify({ values, files })) }
  }
  async preview(body, userId) {
    const selection = this.selection(body)
    const items = selection.ids.map(id => this.snapshot(id, selection))
    if (items.flatMap(item => item.files).reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) throw failFeishu('单次附件总量不能超过 100MB，请分批同步')
    const config = this.config()
    // Local preview is available before any Feishu table/app has been configured.
    let report = null, attachmentAccess = { state: 'unknown' }
    if (config?.app_secret) {
      const check = await this.probe(); report = check.fields; attachmentAccess = check.attachment_access
    }
    for (const [key, entry] of this.previews) if (entry.expires < Date.now()) this.previews.delete(key)
    if (this.previews.size >= 100) this.previews.delete(this.previews.keys().next().value)
    const token = randomUUID()
    const hasFiles = items.some(item => item.files.length)
    const needed = [...selection.fields, ...(hasFiles ? ['attachments'] : [])]
    const issues = report?.filter(field => needed.includes(field.key) && field.state !== 'ok') || []
    this.previews.set(token, { selection, items, userId, configHash: digest(JSON.stringify(config)), expires: Date.now() + 10 * 60 * 1000 })
    return { token, configured: Boolean(config?.app_secret), ready: Boolean(config?.app_secret) && !issues.length && (!hasFiles || attachmentAccess.state !== 'missing'), attachment_access: attachmentAccess,
      base_url: config?.base_url || '', issues, fields: FEISHU_FIELDS.filter(field => selection.fields.includes(field.key)),
      items: items.map(item => ({ ...item, fingerprint: undefined, source_key: undefined })) }
  }
  async push(token, userId, onResult = () => {}) {
    return this.exclusive(async () => {
      const preview = this.previews.get(token)
      if (!preview || preview.userId !== userId || preview.expires < Date.now()) throw failFeishu('预览已失效，请重新预览', 409)
      const { client, config, hash, target } = this.configuredClient()
      if (hash !== preview.configHash) throw failFeishu('飞书配置已变更，请重新预览', 409)
      if (preview.items.some(item => item.files.length)) {
        const access = await client.uploadAccess?.({ forceRefresh: true })
        if (access?.state === 'missing') throw failFeishu(access.message, 403, { feishuCode: 99991672 })
      }
      const report = await client.fields()
      const needed = [...preview.selection.fields, ...(preview.items.some(item => item.files.length) ? ['attachments'] : [])]
      if (schemaReport(report).some(field => needed.includes(field.key) && field.state !== 'ok')) throw failFeishu('飞书字段已变更，请重新检查并预览', 409)
      const results = []; let permissionError = ''
      for (const [index, item] of preview.items.entries()) {
        try {
          const fresh = this.snapshot(item.id, preview.selection)
          if (fresh.fingerprint !== item.fingerprint) throw failFeishu('本地资料或附件已变更，请重新预览该人选', 409)
          const remote = await client.find(item.source_key)
          const link = this.db.prepare('SELECT * FROM feishu_sync_records WHERE target_key=? AND source_key=?').get(target, item.source_key)
          if (!remote && link?.record_id) throw failFeishu('飞书原记录已删除或不可见，请检查权限和本地人选标识后重试', 409)
          if (remote && link?.record_id && remote.record_id !== link.record_id) throw failFeishu('飞书记录编号发生变化，请检查是否复制了本地人选标识', 409)
          if (!link) this.db.prepare('INSERT INTO feishu_sync_records(target_key,source_key,create_token,pending_time) VALUES(?,?,?,?)').run(target, item.source_key, randomUUID(), new Date().toISOString())
          const request = this.db.prepare('SELECT * FROM feishu_sync_records WHERE target_key=? AND source_key=?').get(target, item.source_key)
          if (!remote && request.pending_hash && request.pending_hash !== item.fingerprint) throw failFeishu('上次新增结果尚未确认，请先恢复上次所选字段及附件重试，或在飞书核对本地人选标识', 409)
          const createToken = request.create_token
          const fields = Object.fromEntries(FEISHU_FIELDS.filter(field => Object.hasOwn(item.values, field.key)).map(field => [field.label, item.values[field.key]]))
          const syncedAt = remote ? new Date().toISOString() : request.pending_time
          fields['本地同步时间'] = syncedAt
          if (item.files.length) {
            const existingFiles = remote?.fields?.['简历附件'] || []
            if (!Array.isArray(existingFiles)) throw failFeishu('飞书附件字段内容无效', 409)
            const tokens = new Set(existingFiles.map(file => file.file_token).filter(Boolean))
            for (const file of item.files) {
              const cached = this.db.prepare('SELECT file_token FROM feishu_sync_files WHERE app_token=? AND content_hash=? AND original_name=?').get(config.app_token, file.content_hash, file.original_name)
              let fileToken = cached?.file_token
              if (!fileToken) {
                const row = this.db.prepare('SELECT * FROM candidate_resumes WHERE id=? AND candidate_id=?').get(file.id, item.id)
                if (!row) throw failFeishu('附件在同步期间被删除，请重新预览', 409)
                const bytes = readFileSync(row.file_path)
                if (digest(bytes) !== file.content_hash) throw failFeishu('附件在同步期间被修改，请重新预览', 409)
                fileToken = await client.upload(row, bytes)
                this.db.prepare('INSERT OR REPLACE INTO feishu_sync_files(app_token,content_hash,original_name,file_token) VALUES(?,?,?,?)').run(config.app_token, file.content_hash, file.original_name, fileToken)
              }
              tokens.add(fileToken)
            }
            fields['简历附件'] = [...tokens].map(file_token => ({ file_token }))
          }
          // Recheck saved fields after awaited network/file operations. A stale preview must not win a local edit.
          if (this.snapshot(item.id, preview.selection).fingerprint !== item.fingerprint) throw failFeishu('同步期间本地资料发生变化，请重新预览', 409)
          if (!remote) this.db.prepare('UPDATE feishu_sync_records SET pending_hash=? WHERE target_key=? AND source_key=?').run(item.fingerprint, target, item.source_key)
          const recordId = await client.write(fields, remote?.record_id, createToken)
          this.db.prepare('UPDATE feishu_sync_records SET record_id=?,synced_at=?,pending_hash=NULL,pending_time=NULL WHERE target_key=? AND source_key=?').run(recordId, syncedAt, target, item.source_key)
          const result = { id: item.id, ok: true, action: remote ? 'updated' : 'created', synced_at: syncedAt }
          onResult(result); results.push(result)
        } catch (error) {
          // Only our own safe errors may be sent to the browser/audit log.
          const result = { id: item.id, ok: false, error: error.statusCode ? error.message : '同步中断，请重试；系统会先核对已有记录' }
          onResult(result); results.push(result)
          if (error.feishuCode === 99991672) {
            permissionError = result.error
            for (const remaining of preview.items.slice(index + 1)) {
              const skipped = { id: remaining.id, ok: false, not_attempted: true, error: `未尝试：${result.error}` }
              onResult(skipped); results.push(skipped)
            }
            break
          }
        }
      }
      this.previews.delete(token)
      return { results, base_url: config.base_url, permission_error: permissionError }
    })
  }
}
