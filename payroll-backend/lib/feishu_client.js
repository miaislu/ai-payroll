// Fixed official endpoints only. The transport can be replaced by isolated tests,
// never by API input or persisted configuration.
export const FEISHU_FIELDS = [
  ['source_key', '本地人选标识', 1, true], ['name', '姓名', 1, true],
  ['phone', '联系电话', 1], ['email', '邮箱', 1], ['job', '应聘岗位', 1],
  ['salary', '期望月薪', 1], ['status', '招聘状态', 1, true],
  ['salary_annual', '期望年薪', 1],
  ['notes_category', '备注选项', 1], ['notes', '备注', 1],
  ['interview_dates', '面试时间', 1], ['interview_records', '面试记录', 1],
  ['channel', '来源渠道', 1], ['apply_date', '建档日期', 1],
  ['skills', '技能', 1], ['education', '教育经历', 1], ['work', '工作经历', 1],
  ['synced_at', '本地同步时间', 1, true], ['attachments', '简历附件', 17]
].map(([key, label, type, required = false]) => ({ key, label, type, required }))

export class FeishuError extends Error {
  constructor(message, statusCode = 400, details = {}) { super(message); this.statusCode = statusCode; this.feishuCode = details.feishuCode }
}
export const failFeishu = (message, statusCode = 400, details) => new FeishuError(message, statusCode, details)
export const UPLOAD_PERMISSION_HINT = '缺少飞书附件上传权限：请在开放平台 → 权限管理 → 应用身份权限，开通“上传图片和附件到云文档中”（docs:document.media:upload），发布新版本后重新预览并同步'
const UPLOAD_SCOPES = ['docs:document.media:upload', 'bitable:app', 'drive:drive', 'docs:doc', 'sheets:spreadsheet', 'vc:material', 'moments:moments', 'mail:user_mailbox.message:modify']

export function parseFeishuLink(value) {
  let url
  try { url = new URL(value) } catch { throw failFeishu('请填写飞书多维表格的完整链接') }
  const match = url.pathname.match(/^\/(base|wiki)\/([a-zA-Z0-9]{10,100})\/?$/)
  const table = url.searchParams.get('table')
  if (url.protocol !== 'https:' || !/^(?:[a-zA-Z0-9-]+\.)*feishu\.cn$/.test(url.hostname)
      || url.port || url.username || url.password || !match || (table != null && !/^tbl[a-zA-Z0-9]{5,100}$/.test(table))) {
    throw failFeishu('请填写有效的飞书多维表格链接，支持 /base/ 和 /wiki/；没有 table 参数时可读取数据表后选择')
  }
  return { kind: match[1], token: match[2], table_id: table,
    base_url: `${url.origin}/${match[1]}/${match[2]}${table ? `?table=${table}` : ''}` }
}

export function parseFeishuTarget(value) {
  const link = parseFeishuLink(value)
  if (link.kind !== 'base' || !link.table_id) throw failFeishu('请先点击“读取数据表”并选择目标数据表，再保存配置')
  return { app_token: link.token, table_id: link.table_id, base_url: link.base_url }
}

export function schemaReport(fields) {
  return FEISHU_FIELDS.map(field => {
    const existing = fields.find(item => item.field_name === field.label)
    return { ...field, state: !existing ? 'missing' : existing.type === field.type ? 'ok' : 'wrong_type' }
  })
}

export class FeishuClient {
  constructor(config, transport = fetch) { this.config = config; this.transport = transport; this.token = null; this.expires = 0; this.scopes = null }

  async raw(url, options, label) {
    let response, result
    try {
      response = await this.transport(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(60000) })
      result = await response.json()
    } catch { throw failFeishu(`${label}失败：网络异常或超时，请稍后重试（不会自动重复新增）`, 502) }
    if (!response.ok || result.code !== 0) {
      const code = Number.isSafeInteger(result.code) ? result.code : response.status
      if (code === 99991672) {
        // Published permission changes need a new token, not the cached old scope set.
        this.token = null; this.expires = 0; this.scopes = null
        if (url.includes('/drive/v1/medias/upload_all')) throw failFeishu(UPLOAD_PERMISSION_HINT, 403, { feishuCode: code })
        throw failFeishu(`${label}失败：飞书应用缺少所需的接口权限（代码 99991672），请在权限管理中开通并发布新版本后重试`, 403, { feishuCode: code })
      }
      // Never echo remote messages: they can contain submitted data or credentials.
      throw failFeishu(`${label}失败（飞书代码 ${code}），请检查应用凭证、表格权限和字段设置`, 502, { feishuCode: code })
    }
    return result
  }

  async accessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && this.token && Date.now() < this.expires) return this.token
    const result = await this.raw('https://accounts.feishu.cn/oauth/v3/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: this.config.app_id, client_secret: this.config.app_secret })
    }, '获取飞书授权')
    if (!result.access_token || !(result.expires_in > 60)) throw failFeishu('飞书授权响应不完整', 502)
    this.token = result.access_token
    this.scopes = typeof result.scope === 'string' ? result.scope.split(/\s+/).filter(Boolean) : null
    this.expires = Date.now() + (result.expires_in - 60) * 1000
    return this.token
  }

  async uploadAccess({ forceRefresh = false } = {}) {
    await this.accessToken({ forceRefresh })
    const state = this.scopes === null ? 'unknown' : UPLOAD_SCOPES.some(scope => this.scopes.includes(scope)) ? 'ok' : 'missing'
    return { state, message: state === 'missing' ? UPLOAD_PERMISSION_HINT : '', scope: 'docs:document.media:upload' }
  }
  async request(suffix, { method = 'GET', body, form } = {}, label = '访问飞书表格') {
    const token = await this.accessToken()
    const result = await this.raw(`https://open.feishu.cn/open-apis/${suffix}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(!form && body ? { 'Content-Type': 'application/json' } : {}) },
      body: form || (body ? JSON.stringify(body) : undefined)
    }, label)
    return result.data || {}
  }

  get tablePath() { return `bitable/v1/apps/${this.config.app_token}/tables/${this.config.table_id}` }
  async wikiBase(nodeToken) {
    let data
    try { data = await this.request(`wiki/v2/spaces/get_node?token=${encodeURIComponent(nodeToken)}&obj_type=wiki`) }
    catch (error) {
      throw failFeishu(`${error.message}。知识库链接还需开通知识库节点读取权限，并确保应用可访问该知识库节点`, error.statusCode || 502)
    }
    if (data.node?.obj_type !== 'bitable') throw failFeishu('此知识库链接指向的不是多维表格，请打开知识库中的具体多维表格再复制链接')
    if (!/^[a-zA-Z0-9]{10,100}$/.test(data.node.obj_token || '')) throw failFeishu('飞书未返回有效的多维表格标识', 502)
    return data.node.obj_token
  }
  async tables(appToken) {
    const items = []; let page = ''
    do {
      const data = await this.request(`bitable/v1/apps/${appToken}/tables?page_size=100${page ? `&page_token=${encodeURIComponent(page)}` : ''}`)
      if (!Array.isArray(data.items)) throw failFeishu('飞书数据表列表响应不完整', 502)
      for (const item of data.items) {
        if (!/^tbl[a-zA-Z0-9]{5,100}$/.test(item.table_id || '') || typeof item.name !== 'string') throw failFeishu('飞书数据表列表格式异常', 502)
        items.push({ table_id: item.table_id, name: item.name })
      }
      if (data.has_more && (!data.page_token || data.page_token === page)) throw failFeishu('飞书数据表分页异常', 502)
      page = data.has_more ? data.page_token : ''
      if (items.length > 1000) throw failFeishu('数据表数量过多，请使用独立的简历库多维表格')
    } while (page)
    if (!items.length) throw failFeishu('没有可访问的数据表，请先在飞书创建数据表并给应用授权', 409)
    return items
  }
  async fields() {
    const fields = []; let page = ''
    do {
      const data = await this.request(`${this.tablePath}/fields?page_size=100${page ? `&page_token=${encodeURIComponent(page)}` : ''}`)
      if (!Array.isArray(data.items)) throw failFeishu('飞书字段响应不完整', 502)
      fields.push(...data.items)
      if (data.has_more && (!data.page_token || data.page_token === page)) throw failFeishu('飞书字段分页异常', 502)
      page = data.has_more ? data.page_token : ''
      if (fields.length > 1000) throw failFeishu('表格字段过多，请使用独立的简历数据表')
    } while (page)
    return fields
  }
  async addField(field) { return this.request(`${this.tablePath}/fields`, { method: 'POST', body: { field_name: field.label, type: field.type } }) }
  async find(sourceKey, fieldName = '本地人选标识') {
    const data = await this.request(`${this.tablePath}/records/search?page_size=2`, { method: 'POST', body: {
      filter: { conjunction: 'and', conditions: [{ field_name: fieldName, operator: 'is', value: [sourceKey] }] }
    } })
    if (!Array.isArray(data.items)) throw failFeishu('飞书记录查询响应不完整', 502)
    if (data.items.length > 1 || data.has_more) throw failFeishu('飞书内有重复的本地人选标识，请先合并重复记录', 409)
    return data.items[0] || null
  }
  async write(fields, recordId, clientToken) {
    const data = await this.request(`${this.tablePath}/records${recordId ? `/${encodeURIComponent(recordId)}` : `?client_token=${clientToken}`}`, {
      method: recordId ? 'PUT' : 'POST', body: { fields }
    })
    if (!data.record?.record_id) throw failFeishu('飞书未返回记录编号，请重试以核对同步结果', 502)
    return data.record.record_id
  }
  async upload(file, bytes) {
    const form = new FormData()
    for (const [key, value] of Object.entries({ file_name: file.original_name, parent_type: 'bitable_file', parent_node: this.config.app_token, size: bytes.length })) form.append(key, String(value))
    form.append('file', new Blob([bytes], { type: file.content_type || 'application/octet-stream' }), file.original_name)
    const data = await this.request('drive/v1/medias/upload_all', { method: 'POST', form }, '上传简历附件')
    if (!data.file_token) throw failFeishu('飞书未返回附件编号，请重试', 502)
    return data.file_token
  }
}
