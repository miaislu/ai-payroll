import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FeishuSync } from '../lib/feishu_sync.js'
import { FeishuClient, FEISHU_FIELDS, parseFeishuLink, parseFeishuTarget, schemaReport, failFeishu } from '../lib/feishu_client.js'

const dir = mkdtempSync(path.join(tmpdir(), 'feishu-test-'))
process.env.DB_PATH = path.join(dir, 'template.db')
const { db: template, migrate } = await import('../db.js')
migrate()
after(() => { template.close(); rmSync(dir, { recursive: true, force: true }) })
const schema = template.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
const configuration = { app_id: 'cli_testapp123', app_secret: 'secret-test-do-not-return', base_url: 'https://example.feishu.cn/base/bascTestBase123?table=tblTestTable123' }
const allFields = () => FEISHU_FIELDS.map(f => ({ field_name: f.label, type: f.type }))

function fixture(t) {
  const database = new DatabaseSync(':memory:')
  for (const row of schema) database.exec(row.sql)
  database.exec('PRAGMA foreign_keys=ON')
  const privateDir = mkdtempSync(path.join(dir, 'case-'))
  const remote = new Map(), uploads = [], writes = []
  let fieldList = allFields(), beforeWrite = null
  const client = {
    wikiBase: async () => 'bascResolvedBase123',
    tables: async () => [{ table_id: 'tblResumeTable123', name: '简历库' }, { table_id: 'tblOtherTable123', name: '其他数据' }],
    fields: async () => structuredClone(fieldList),
    addField: async field => { fieldList.push({ field_name: field.label, type: field.type }) },
    find: async key => structuredClone(remote.get(key) || null),
    upload: async (file, bytes) => { uploads.push({ file, bytes }); return `file_${uploads.length}` },
    write: async (fields, recordId, token) => {
      writes.push({ fields, recordId, token })
      if (beforeWrite) await beforeWrite(fields, recordId, token)
      const existing = remote.get(fields['本地人选标识'])
      const record = { record_id: recordId || `rec_${remote.size + 1}`, fields: { ...(existing?.fields || {}), ...fields } }
      remote.set(fields['本地人选标识'], record)
      return record.record_id
    }
  }
  const configFile = path.join(privateDir, 'feishu-config.json')
  const sync = new FeishuSync(database, configFile, () => client)
  const addCandidate = (name = '合成测试人选') => Number(database.prepare("INSERT INTO candidates(name,phone,email,stage,created_at) VALUES(?,?,?,'waiting',?)").run(name, '13800000000', 'test@example.com', '2026-10-26').lastInsertRowid)
  const addFile = (id, name, content) => {
    const filePath = path.join(privateDir, `resume-${Math.random()}.txt`)
    writeFileSync(filePath, content)
    return Number(database.prepare('INSERT INTO candidate_resumes(candidate_id,filename,original_name,file_path,size,uploaded_at) VALUES(?,?,?,?,?,?)').run(id, path.basename(filePath), name, filePath, Buffer.byteLength(content), new Date().toISOString()).lastInsertRowid)
  }
  const selection = (ids, attachments = {}, fields = ['name', 'phone', 'skills', 'education', 'work']) => ({ candidate_ids: ids, attachments, fields })
  t.after(() => database.close())
  return { database, sync, client, remote, uploads, writes, addCandidate, addFile, selection, configFile,
    setFields: fields => { fieldList = fields }, setBeforeWrite: operation => { beforeWrite = operation } }
}

test('年薪仅写入独立年薪列，并保留既有月薪与附件', async t => {
  const f = fixture(t), id = f.addCandidate()
  f.sync.save(configuration)
  f.database.prepare('UPDATE candidates SET expected_salary_annual=?,expected_salary=? WHERE id=?').run(1200000, 50000, id)
  const p = await f.sync.preview(f.selection([id], {}, ['salary_annual']), 1)
  assert.equal(p.items[0].values.salary_annual, '¥1,200,000/年')
  assert.equal(Object.hasOwn(p.items[0].values, 'salary'), false)
  assert.equal((await f.sync.push(p.token, 1)).results[0].ok, true)
  const remote = [...f.remote.values()][0]
  assert.equal(remote.fields['期望年薪'], '¥1,200,000/年')
  assert.equal(Object.hasOwn(remote.fields, '期望月薪'), false)
  f.database.prepare('UPDATE candidates SET expected_salary_annual=? WHERE id=?').run(1500000, id)
  const p2 = await f.sync.preview(f.selection([id], {}, ['salary_annual']), 1)
  assert.equal((await f.sync.push(p2.token, 1)).results[0].action, 'updated')
  assert.equal(f.remote.size, 1)
  assert.equal([...f.remote.values()][0].fields['期望年薪'], '¥1,500,000/年')
})

test('新简历与已安排待面试状态在飞书中不混淆', async t => {
  const f = fixture(t), id = f.addCandidate()
  f.database.prepare("UPDATE candidates SET stage='new' WHERE id=?").run(id)
  const fresh = await f.sync.preview(f.selection([id], {}, ['status']), 1)
  assert.equal(fresh.items[0].values.status, '新简历')
  f.database.prepare("UPDATE candidates SET stage='waiting' WHERE id=?").run(id)
  const scheduled = await f.sync.preview(f.selection([id], {}, ['status']), 1)
  assert.equal(scheduled.items[0].values.status, '待面试')
})

test('固定飞书目标及字段类型校验', () => {
  assert.equal(parseFeishuTarget(configuration.base_url).table_id, 'tblTestTable123')
  for (const url of ['http://127.0.0.1/base/bascTestBase123?table=tblTestTable123', 'https://example.feishu.cn.evil.test/base/bascTestBase123?table=tblTestTable123', 'https://example.feishu.cn/wiki/bascTestBase123?table=tblTestTable123', 'https://example.feishu.cn/base/bascTestBase123', 'https://x:secret@example.feishu.cn/base/bascTestBase123?table=tblTestTable123']) assert.throws(() => parseFeishuTarget(url))
  assert.equal(schemaReport([{ field_name: '姓名', type: 2 }]).find(f => f.key === 'name').state, 'wrong_type')
})

test('未配置可预览，凭证0600且不回显，空密钥保留但换应用须重填', async t => {
  const f = fixture(t), id = f.addCandidate()
  const p = await f.sync.preview(f.selection([id]), 1)
  assert.equal(p.ready, false)
  await assert.rejects(f.sync.push(p.token, 1), /先创建/)
  assert.throws(() => f.sync.save({ ...configuration, base_url: 'http://localhost/' }))
  assert.equal(JSON.stringify(f.sync.save(configuration)).includes(configuration.app_secret), false)
  assert.equal(statSync(f.configFile).mode & 0o777, 0o600)
  f.sync.save({ ...configuration, app_secret: '' })
  assert.equal(JSON.parse(readFileSync(f.configFile)).app_secret, configuration.app_secret)
  assert.throws(() => f.sync.save({ ...configuration, app_id: 'cli_newapp123', app_secret: '' }), /App Secret/)
})

test('所选文件/已确认资料同步，重复更新保留云端协作列和已有附件', async t => {
  const f = fixture(t), id = f.addCandidate(), a = f.addFile(id, '同名简历.txt', 'first'), b = f.addFile(id, '同名简历.txt', 'second')
  f.sync.save(configuration)
  f.database.prepare('UPDATE candidates SET skills=?,resume_parsed=?,profile_json=? WHERE id=?').run('未确认提取', '{"basic":{"skills":"未确认"}}', JSON.stringify({ basic: { skills: '已确认技能', gender: '不应导出' }, work_experience: [{ company: '虚构公司', title: '工程师' }] }), id)
  let p = await f.sync.preview(f.selection([id], { [id]: [b] }), 1)
  assert.equal(p.items[0].values.skills, '已确认技能')
  assert.equal(JSON.stringify(p).includes('不应导出'), false)
  assert.equal((await f.sync.push(p.token, 1)).results[0].action, 'created')
  assert.equal(f.uploads.length, 1); assert.equal(f.uploads[0].bytes.toString(), 'second')
  const key = [...f.remote.keys()][0]
  f.remote.get(key).fields['跟进备注'] = '保留云端协作备注'
  f.remote.get(key).fields['简历附件'].push({ file_token: 'manual_file' })
  p = await f.sync.preview(f.selection([id], { [id]: [a, b] }, ['name']), 1)
  assert.equal((await f.sync.push(p.token, 1)).results[0].action, 'updated')
  assert.equal(f.remote.size, 1); assert.equal(f.uploads.length, 2)
  assert.equal(f.remote.get(key).fields['跟进备注'], '保留云端协作备注')
  assert.equal(f.remote.get(key).fields['技能'], '已确认技能')
  assert.equal(f.remote.get(key).fields['简历附件'].length, 3)
  await assert.rejects(f.sync.push(p.token, 1), /预览已失效/)
})

test('跨人选附件/未知字段/过量请求被拒绝，未确认的经历不导出', async t => {
  const f = fixture(t), id = f.addCandidate(), other = f.addCandidate(), foreign = f.addFile(other, 'other.txt', 'other')
  await assert.rejects(f.sync.preview(f.selection([id], { [id]: [foreign] }), 1), /不属于/)
  await assert.rejects(f.sync.preview(f.selection([id], { [other]: [foreign] }), 1), /不属于/)
  await assert.rejects(f.sync.preview(f.selection([id], {}, ['date_of_birth']), 1), /字段无效/)
  await assert.rejects(f.sync.preview(f.selection(Array(21).fill(id)), 1), /20/)
  f.database.prepare('UPDATE candidates SET skills=?,resume_parsed=? WHERE id=?').run('规则技能', '{"work_experience":[{"company":"未确认公司"}]}', id)
  const p = await f.sync.preview(f.selection([id]), 1)
  assert.equal(p.items[0].values.skills, ''); assert.equal(p.items[0].values.work, '')
})

test('预览绑定用户、目标、资料及文件内容；变更后不误发', async t => {
  const f = fixture(t), id = f.addCandidate(), rid = f.addFile(id, 'resume.txt', 'old')
  f.sync.save(configuration)
  let p = await f.sync.preview(f.selection([id], { [id]: [rid] }), 1)
  await assert.rejects(f.sync.push(p.token, 2), /预览已失效/)
  f.database.prepare('UPDATE candidates SET phone=? WHERE id=?').run('13900000000', id)
  assert.equal((await f.sync.push(p.token, 1)).results[0].ok, false)
  p = await f.sync.preview(f.selection([id], { [id]: [rid] }), 1)
  writeFileSync(f.database.prepare('SELECT file_path FROM candidate_resumes WHERE id=?').get(rid).file_path, 'changed')
  assert.equal((await f.sync.push(p.token, 1)).results[0].ok, false)
  p = await f.sync.preview(f.selection([id]), 1)
  f.sync.save({ ...configuration, base_url: 'https://example.feishu.cn/base/bascOtherBase123?table=tblTestTable123' })
  await assert.rejects(f.sync.push(p.token, 1), /预览已失效/)
  assert.equal(f.writes.length, 0)
})

test('同名和被复用的本地数字编号均有独立标识', async t => {
  const f = fixture(t), id = f.addCandidate('同名测试'), second = f.addCandidate('同名测试')
  f.sync.save(configuration)
  let p = await f.sync.preview(f.selection([id, second]), 1)
  await f.sync.push(p.token, 1); assert.equal(f.remote.size, 2)
  f.database.prepare('DELETE FROM candidates WHERE id=?').run(id)
  f.database.prepare("INSERT INTO candidates(id,name,stage,created_at) VALUES(?,'同名测试','new','2026-10-26')").run(id)
  p = await f.sync.preview(f.selection([id]), 1)
  await f.sync.push(p.token, 1); assert.equal(f.remote.size, 3)
})

test('部分失败独立重试，复用上传文件与幂等号，响应丢失后不重复创建', async t => {
  const f = fixture(t), id = f.addCandidate('失败测试'), other = f.addCandidate('成功测试'), rid = f.addFile(id, 'retry.txt', 'retry')
  f.sync.save(configuration)
  f.setBeforeWrite(fields => { if (fields['姓名'] === '失败测试') throw failFeishu('模拟飞书暂时失败', 502) })
  let p = await f.sync.preview(f.selection([id, other], { [id]: [rid] }), 1)
  assert.deepEqual((await f.sync.push(p.token, 1)).results.map(row => row.ok), [false, true])
  const firstToken = f.writes[0].token
  f.setBeforeWrite(null)
  p = await f.sync.preview(f.selection([id], { [id]: [rid] }), 1)
  assert.equal((await f.sync.push(p.token, 1)).results[0].ok, true)
  assert.equal(f.writes.at(-1).token, firstToken); assert.equal(f.uploads.length, 1)
  assert.deepEqual(f.writes.at(-1).fields, f.writes[0].fields, '未确认的新建重试须复用完全相同的请求，包含时间字段')
  const third = f.addCandidate('超时测试')
  f.setBeforeWrite(fields => { f.remote.set(fields['本地人选标识'], { record_id: 'rec_timeout', fields }); throw failFeishu('模拟已写入但响应丢失', 502) })
  p = await f.sync.preview(f.selection([third]), 1)
  assert.equal((await f.sync.push(p.token, 1)).results[0].ok, false)
  f.setBeforeWrite(null)
  p = await f.sync.preview(f.selection([third]), 1)
  assert.equal((await f.sync.push(p.token, 1)).results[0].action, 'updated')
  assert.equal(f.writes.at(-1).recordId, 'rec_timeout')
})

test('远端丢失已有记录不自动重建；字段冲突停止，初始化仅补缺列', async t => {
  const f = fixture(t), id = f.addCandidate()
  f.sync.save(configuration)
  let p = await f.sync.preview(f.selection([id]), 1)
  await f.sync.push(p.token, 1); f.remote.clear()
  p = await f.sync.preview(f.selection([id]), 1)
  assert.match((await f.sync.push(p.token, 1)).results[0].error, /不可见/)
  assert.equal(f.writes.length, 1)
  f.setFields([{ field_name: '姓名', type: 2 }])
  await assert.rejects(f.sync.initialize(), /类型/)
  p = await f.sync.preview(f.selection([id]), 1)
  assert.equal(p.ready, false); await assert.rejects(f.sync.push(p.token, 1), /字段/)
  f.setFields([{ field_name: '姓名', type: 1 }, { field_name: '自建备注', type: 1 }])
  assert.equal((await f.sync.initialize()).fields.every(field => field.state === 'ok'), true)
})

test('官方HTTP契约：令牌缓存、过滤查询、multipart、禁重定向、脱敏错误', async () => {
  const calls = []
  const transport = async (url, options) => {
    calls.push({ url, options }); assert.equal(options.redirect, 'error'); assert.ok(options.signal)
    if (url.includes('/oauth/')) return Response.json({ code: 0, access_token: 'test-access-token', expires_in: 7200 })
    assert.equal(options.headers.Authorization, 'Bearer test-access-token')
    if (url.includes('/fields')) return Response.json({ code: 0, data: { items: allFields(), has_more: false } })
    if (url.includes('/search')) {
      assert.deepEqual(JSON.parse(options.body).filter.conditions, [{ field_name: '本地人选标识', operator: 'is', value: ['source_test'] }])
      return Response.json({ code: 0, data: { items: [] } })
    }
    assert.equal(url, 'https://open.feishu.cn/open-apis/drive/v1/medias/upload_all')
    assert.equal(options.body.get('parent_type'), 'bitable_file'); assert.equal(options.body.get('parent_node'), 'bascTestBase123')
    assert.equal(await options.body.get('file').text(), 'resume-content')
    return Response.json({ code: 0, data: { file_token: 'file_token_test' } })
  }
  const client = new FeishuClient({ ...configuration, ...parseFeishuTarget(configuration.base_url) }, transport)
  await client.fields(); await client.find('source_test')
  assert.equal(await client.upload({ original_name: '测试.txt' }, Buffer.from('resume-content')), 'file_token_test')
  assert.equal(calls.filter(c => c.url.includes('/oauth/')).length, 1)
  const bad = new FeishuClient(configuration, async () => Response.json({ code: 20002, msg: 'secret-sensitive-message' }))
  await assert.rejects(bad.accessToken(), error => error.statusCode === 502 && !error.message.includes('sensitive'))
  const duplicate = new FeishuClient({ ...configuration, ...parseFeishuTarget(configuration.base_url) }, async url => Response.json(url.includes('/oauth/') ? { code: 0, access_token: 't', expires_in: 7200 } : { code: 0, data: { items: [{}, {}] } }))
  await assert.rejects(duplicate.find('duplicate'), /重复/)
})

test('知识库及不带table的链接可读取列表；多表不默认选择，保存服务端解析的真实Base标识', async t => {
  const f = fixture(t), wiki = 'https://example.feishu.cn/wiki/wikSyntheticNode123?from=from_copylink'
  assert.equal(parseFeishuLink(wiki).table_id, null)
  assert.equal(parseFeishuLink('https://example.feishu.cn/base/bascTestBase123').kind, 'base')
  const body = { ...configuration, base_url: wiki }
  const resolved = await f.sync.resolveLink(body, 1)
  assert.equal(resolved.tables.length, 2); assert.equal(resolved.selected_table_id, '')
  assert.equal(JSON.stringify(resolved).includes(configuration.app_secret), false)
  assert.throws(() => f.sync.saveLink({ ...body, resolution_token: resolved.resolution_token }, 1), /选择目标/)
  assert.throws(() => f.sync.saveLink({ ...body, resolution_token: resolved.resolution_token, table_id: 'tblResumeTable123' }, 2), /重新读取/)
  assert.throws(() => f.sync.saveLink({ ...body, app_secret: 'different-secret', resolution_token: resolved.resolution_token, table_id: 'tblResumeTable123' }, 1), /重新读取/)
  assert.throws(() => f.sync.saveLink({ ...body, resolution_token: resolved.resolution_token, table_id: 'tblUnlistedTable123' }, 1), /选择目标/)
  const status = f.sync.saveLink({ ...body, resolution_token: resolved.resolution_token, table_id: 'tblResumeTable123', app_token: 'ignored-untrusted-token' }, 1)
  assert.equal(status.configured, true)
  assert.equal(status.base_url, 'https://example.feishu.cn/wiki/wikSyntheticNode123?table=tblResumeTable123')
  assert.equal(JSON.parse(readFileSync(f.configFile)).app_token, 'bascResolvedBase123')
  // Existing direct links continue to save without a metadata lookup.
  assert.equal(f.sync.saveLink(configuration, 1).configured, true)
  await assert.rejects(f.sync.resolveLink({ ...body, base_url: wiki + '&table=tblInaccessible123' }, 1), /无权访问/)
})

test('解析结果绑定链接且有有效期，目标变更需重读；没有读取时不能误存wiki节点标识', async t => {
  const f = fixture(t), body = { ...configuration, base_url: 'https://example.feishu.cn/wiki/wikSyntheticNode123' }
  assert.throws(() => f.sync.saveLink(body, 1), /读取数据表/)
  let r = await f.sync.resolveLink(body, 1)
  assert.throws(() => f.sync.saveLink({ ...body, base_url: 'https://example.feishu.cn/wiki/wikAnotherNode123', resolution_token: r.resolution_token, table_id: r.tables[0].table_id }, 1), /重新读取/)
  f.sync.resolutions.get(r.resolution_token).expires = Date.now() - 1
  assert.throws(() => f.sync.saveLink({ ...body, resolution_token: r.resolution_token, table_id: r.tables[0].table_id }, 1), /重新读取/)
  r = await f.sync.resolveLink({ ...body, base_url: 'https://example.feishu.cn/base/bascTestBase123?table=tblResumeTable123' }, 1)
  assert.equal(r.selected_table_id, 'tblResumeTable123')
})

test('官方wiki节点解析和数据表分页契约；普通文档、权限不足、畸形分页均不会作为Base使用', async () => {
  const calls = []
  const client = new FeishuClient(configuration, async (url, options) => {
    calls.push(url)
    assert.equal(options.redirect, 'error')
    if (url.includes('/oauth/')) return Response.json({ code: 0, access_token: 't', expires_in: 7200 })
    if (url.includes('/get_node')) {
      assert.equal(url, 'https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=wikSyntheticNode123&obj_type=wiki')
      return Response.json({ code: 0, data: { node: { obj_type: 'bitable', obj_token: 'bascResolvedBase123' } } })
    }
    assert.ok(url.startsWith('https://open.feishu.cn/open-apis/bitable/v1/apps/bascResolvedBase123/tables?page_size=100'))
    return Response.json({ code: 0, data: url.includes('page_token=next')
      ? { items: [{ table_id: 'tblSecondTable123', name: '第二张' }], has_more: false }
      : { items: [{ table_id: 'tblFirstTable123', name: '第一张' }], has_more: true, page_token: 'next' } })
  })
  const appToken = await client.wikiBase('wikSyntheticNode123')
  assert.equal((await client.tables(appToken)).length, 2)
  assert.equal(calls.filter(url => url.includes('/oauth/')).length, 1)
  const doc = new FeishuClient(configuration, async url => Response.json(url.includes('/oauth/') ? { code: 0, access_token: 't', expires_in: 7200 } : { code: 0, data: { node: { obj_type: 'docx', obj_token: 'docxWrongType123' } } }))
  await assert.rejects(doc.wikiBase('wikSyntheticNode123'), /不是多维表格/)
  const denied = new FeishuClient(configuration, async () => Response.json({ code: 99991672, msg: 'remote-sensitive-do-not-echo' }))
  await assert.rejects(denied.wikiBase('wikSyntheticNode123'), error => error.message.includes('知识库节点读取权限') && !error.message.includes('sensitive'))
  const badPage = new FeishuClient(configuration, async url => Response.json(url.includes('/oauth/') ? { code: 0, access_token: 't', expires_in: 7200 } : { code: 0, data: { items: [], has_more: true } }))
  await assert.rejects(badPage.tables('bascResolvedBase123'), /分页异常/)
})

test('缺少附件权限时预览和发送提前阻止，纯资料同步可用，授权后重新预览即可发送', async t => {
  const f = fixture(t), id = f.addCandidate(), rid = f.addFile(id, 'test.txt', 'synthetic-resume')
  f.sync.save(configuration)
  let permission = false
  f.client.uploadAccess = async options => {
    assert.equal(options.forceRefresh, true)
    return { state: permission ? 'ok' : 'missing', message: '缺少 docs:document.media:upload，发布后重新预览' }
  }
  let p = await f.sync.preview(f.selection([id], { [id]: [rid] }), 1)
  assert.equal(p.ready, false); assert.equal(p.attachment_access.state, 'missing')
  await assert.rejects(f.sync.push(p.token, 1), error => error.statusCode === 403 && error.feishuCode === 99991672)
  assert.equal(f.uploads.length, 0); assert.equal(f.writes.length, 0)
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM feishu_sync_records').get().n, 0)
  p = await f.sync.preview(f.selection([id]), 1)
  assert.equal(p.ready, true)
  assert.equal((await f.sync.push(p.token, 1)).results[0].ok, true)
  permission = true
  p = await f.sync.preview(f.selection([id], { [id]: [rid] }), 1)
  assert.equal(p.ready, true)
  assert.equal((await f.sync.push(p.token, 1)).results[0].ok, true)
  assert.equal(f.uploads.length, 1)
})

test('飞书拒绝权限时停止整批其余请求，单独标记未尝试项', async t => {
  const f = fixture(t), a = f.addCandidate(), b = f.addCandidate()
  f.sync.save(configuration)
  f.setBeforeWrite(() => { throw failFeishu('需要开通对应权限', 403, { feishuCode: 99991672 }) })
  const p = await f.sync.preview(f.selection([a, b]), 1)
  const result = await f.sync.push(p.token, 1)
  assert.equal(result.results.length, 2); assert.equal(f.writes.length, 1)
  assert.equal(result.results[0].ok, false); assert.equal(result.results[1].not_attempted, true)
  assert.equal(result.permission_error, '需要开通对应权限')
})

test('权限检查刷新旧令牌；99991672给出准确上传权限并丢弃缓存，不暴露服务端原文', async () => {
  let authCalls = 0, permitted = false
  const client = new FeishuClient(configuration, async url => {
    if (url.includes('/oauth/')) {
      authCalls++
      return Response.json({ code: 0, access_token: `token_${authCalls}`, expires_in: 7200,
        scope: permitted ? 'base:record:create docs:document.media:upload' : 'base:record:create wiki:node:read' })
    }
    return Response.json({ code: 99991672, msg: 'sensitive-provider-response' }, { status: 400 })
  })
  assert.equal((await client.uploadAccess({ forceRefresh: true })).state, 'missing')
  permitted = true
  assert.equal((await client.uploadAccess({ forceRefresh: true })).state, 'ok')
  assert.equal(authCalls, 2)
  await assert.rejects(client.upload({ original_name: 'fake.txt' }, Buffer.from('synthetic')), error =>
    error.feishuCode === 99991672 && error.message.includes('docs:document.media:upload') && !error.message.includes('sensitive'))
  assert.equal(client.token, null)
  await client.accessToken(); assert.equal(authCalls, 3)
})


test('备注选项与正文独立同步，预览后修改须重读，清空不改招聘状态和协作列', async t => {
  const f = fixture(t), id = f.addCandidate()
  f.sync.save(configuration)
  f.setFields(allFields().filter(field => !['备注选项', '备注'].includes(field.field_name)))
  const initialized = await f.sync.initialize()
  assert.equal(initialized.fields.filter(field => ['notes_category', 'notes'].includes(field.key)).every(field => field.state === 'ok'), true)
  for (const [category, label] of [['high', '高意向'], ['pending', '待定'], ['custom', '自定义']]) {
    f.database.prepare('UPDATE candidates SET notes_category=?,notes=? WHERE id=?').run(category, '联系记录\n下周跟进', id)
    const preview = await f.sync.preview(f.selection([id], {}, ['notes_category', 'notes']), 1)
    assert.equal(preview.items[0].values.notes_category, label)
    assert.equal(preview.items[0].values.notes, '联系记录\n下周跟进')
    assert.equal((await f.sync.push(preview.token, 1)).results[0].ok, true)
  }
  const remote = [...f.remote.values()][0]
  remote.fields['负责人'] = '保留协作资料'
  f.remote.set(remote.fields['本地人选标识'], remote)
  const stale = await f.sync.preview(f.selection([id], {}, ['notes']), 1)
  f.database.prepare("UPDATE candidates SET notes='' WHERE id=?").run(id)
  const staleResult = await f.sync.push(stale.token, 1)
  assert.equal(staleResult.results[0].ok, false)
  assert.match(staleResult.results[0].error, /变更/)
  f.database.prepare("UPDATE candidates SET notes_category='' WHERE id=?").run(id)
  const empty = await f.sync.preview(f.selection([id], {}, ['notes_category', 'notes']), 1)
  assert.equal((await f.sync.push(empty.token, 1)).results[0].action, 'updated')
  const updated = [...f.remote.values()][0]
  assert.equal(updated.fields['备注'], '')
  assert.equal(updated.fields['备注选项'], '')
  assert.equal(updated.fields['负责人'], '保留协作资料')
  assert.equal(updated.fields['招聘状态'], '待面试')
  assert.equal(f.remote.size, 1)
})


test('面试日期及全轮次记录同步；未通过不混为取消，待面试不虚构结果；修改面评使旧预览失效', async t => {
  const f = fixture(t), id = f.addCandidate(), other = f.addCandidate('其他虚构人选')
  f.sync.save(configuration)
  const add = (candidate, round, date, state, result, score, notes) => Number(f.database.prepare('INSERT INTO interviews(candidate_id,round_no,interview_date,interviewer,status,result,score,notes) VALUES(?,?,?,?,?,?,?,?)').run(candidate,round,date,'测试面试官',state,result,score,notes).lastInsertRowid)
  add(id, 2, '2026-11-01', 'scheduled', 'pending', null, '')
  const completed = add(id, 1, '2026-10-29', 'completed', 'not_recommend', 2, '技术沟通记录\n后续说明')
  add(id, 3, '2026-11-02', 'cancelled', 'pending', null, '安排取消')
  add(other, 1, '2026-10-30', 'completed', 'recommend', 4, '其他人的面评不得混入')
  let preview = await f.sync.preview(f.selection([id], {}, ['interview_dates','interview_records']), 1)
  assert.match(preview.items[0].values.interview_dates, /^第 1 轮 · 2026-10-29 · 已完成 · 未通过/)
  assert.match(preview.items[0].values.interview_records, /结论：不推荐\n评分：2\n面评：技术沟通记录\n后续说明/)
  assert.match(preview.items[0].values.interview_dates, /第 2 轮 · 2026-11-01 · 待面试/)
  assert.match(preview.items[0].values.interview_dates, /第 3 轮 · 2026-11-02 · 已取消/)
  assert.equal(preview.items[0].values.interview_records.includes('结论：待定'), false)
  assert.equal(JSON.stringify(preview.items).includes('其他人的面评'), false)
  f.database.prepare('UPDATE interviews SET notes=? WHERE id=?').run('更新面评',completed)
  assert.equal((await f.sync.push(preview.token,1)).results[0].ok,false)
  preview=await f.sync.preview(f.selection([id], {}, ['interview_dates','interview_records']),1)
  assert.equal((await f.sync.push(preview.token,1)).results[0].ok,true)
  assert.match([...f.remote.values()][0].fields['面试记录'],/更新面评/)
  f.database.prepare('DELETE FROM interviews WHERE candidate_id=?').run(id)
  preview=await f.sync.preview(f.selection([id], {}, ['interview_dates','interview_records']),1)
  assert.equal((await f.sync.push(preview.token,1)).results[0].action,'updated')
  assert.equal([...f.remote.values()][0].fields['面试时间'],'')
  assert.equal([...f.remote.values()][0].fields['面试记录'],'')
  const unselected=await f.sync.preview(f.selection([other], {}, ['notes']),1)
  assert.equal(Object.hasOwn(unselected.items[0].values,'interview_records'),false)
})

test('选择面试同步时同时更新按轮次的日期表，保留配置绑定，重复发送不新增', async t => {
  const f=fixture(t),id=f.addCandidate('日期表测试人选')
  f.sync.save(configuration)
  const saved=JSON.parse(readFileSync(f.configFile));saved.interviews_table_id='tblInterviews123';writeFileSync(f.configFile,JSON.stringify(saved))
  const {interviewTableFields}=await import('../lib/feishu_interview_table.js')
  const remote=new Map()
  const client={config:{...saved,table_id:saved.interviews_table_id},fields:async()=>interviewTableFields(saved.table_id),find:async key=>structuredClone(remote.get(key)||null),write:async(fields,recordId)=>{const record={record_id:recordId||'recInterview123',fields};remote.set(fields['本地面试标识'],record);return record.record_id}}
  f.sync.clientFactory=config=>config.table_id===saved.interviews_table_id?client:f.client
  f.database.prepare("INSERT INTO interviews(candidate_id,round_no,interview_date,interviewer,status,result) VALUES(?,1,'2026-11-01','测试官','scheduled','pending')").run(id)
  for(let n=0;n<2;n++){
    const preview=await f.sync.preview(f.selection([id],{},['interview_dates','interview_records']),1)
    const result=await f.sync.push(preview.token,1)
    assert.equal(result.results[0].ok,true)
    assert.equal(result.results[0].interviews_synced,1)
  }
  assert.equal(remote.size,1)
  assert.equal(typeof [...remote.values()][0].fields['面试时间'],'number')
  f.sync.save({...configuration,app_secret:''})
  assert.equal(JSON.parse(readFileSync(f.configFile)).interviews_table_id,saved.interviews_table_id)
  f.sync.save({...configuration,base_url:'https://example.feishu.cn/base/bascOtherBase123?table=tblTestTable123'})
  assert.equal(JSON.parse(readFileSync(f.configFile)).interviews_table_id,undefined)
})
