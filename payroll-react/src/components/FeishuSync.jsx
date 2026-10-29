import { useEffect, useState } from 'react'
import { Btn, Chip, Field, Hint, Modal } from './ui.jsx'
import { useDialog } from './DialogProvider.jsx'
import { getFeishuConfig, saveFeishuConfig, resolveFeishuLink, probeFeishu, initializeFeishuFields, previewFeishuSync, pushFeishuSync } from '../api.js'

const stateLabel = { ok: '就绪', missing: '待添加', wrong_type: '类型需调整' }

export default function FeishuSync({ candidates, user, onClose }) {
  const { confirm } = useDialog()
  const [config, setConfig] = useState(null)
  const [form, setForm] = useState({ base_url: '', app_id: '', app_secret: '' })
  const [connection, setConnection] = useState(null)
  const [tab, setTab] = useState('sync')
  const [selected, setSelected] = useState([])
  const [fields, setFields] = useState([])
  const [attachments, setAttachments] = useState({})
  const [report, setReport] = useState(null)
  const [preview, setPreview] = useState(null)
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const configChanged = config && (form.base_url.trim() !== config.base_url || form.app_id.trim() !== config.app_id
    || Boolean(form.app_secret.trim()) || Boolean(connection && form.table_id !== config.table_id))
  useEffect(() => {
    let alive = true
    getFeishuConfig().then(value => {
      if (!alive) return
      setConfig(value); setForm({ base_url: value.base_url, app_id: value.app_id, app_secret: '', table_id: value.table_id || '' })
      setFields(value.fields.filter(field => field.key !== 'attachments').map(field => field.key))
    }).catch(error => { if (alive) setError(error.message) })
    return () => { alive = false }
  }, [])
  const run = async operation => {
    setBusy(true); setError('')
    try { await operation() } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  const changeConfig = (key, value) => {
    setForm(previous => ({ ...previous, [key]: value })); setConnection(null); setReport(null); setPreview(null)
  }
  const changeSelection = id => {
    setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])
    setPreview(null); setResults(null)
  }
  const changeFile = (id, rid) => {
    setAttachments(previous => ({ ...previous, [id]: (previous[id] || []).includes(rid)
      ? previous[id].filter(value => value !== rid) : [...(previous[id] || []), rid] }))
    setPreview(null); setResults(null)
  }
  const doPreview = () => run(async () => {
    setResults(null)
    const value = await previewFeishuSync({ candidate_ids: selected, fields,
      attachments: Object.fromEntries(selected.map(id => [id, attachments[id] || []])) })
    setPreview(value)
  })
  const doPush = () => run(async () => {
    if (!await confirm({ title: '发送到飞书简历库', message: `将预览中的 ${preview.items.length} 位人选及 ${preview.items.reduce((n, item) => n + item.files.length, 0)} 份附件发送到下方表格。已有记录会更新所选字段，已有附件会保留。\n${preview.base_url}`, confirmLabel: '确认发送' })) return
    const value = await pushFeishuSync(preview.token)
    setResults(value.results); setPreview(null)
    if (value.permission_error) setError(value.permission_error)
  })

  return <Modal onClose={busy ? undefined : onClose}>
    <div className="modal" style={{ width: 1000, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="同步到飞书多维表格">
      <h3>同步到飞书多维表格</h3>
      <div className="row"><Btn disabled={busy} primary={tab === 'sync'} onClick={() => setTab('sync')}>选择与预览</Btn><Btn disabled={busy} primary={tab === 'config'} onClick={() => setTab('config')}>连接配置 / 建表指引</Btn></div>
      {error && <p role="alert" style={{ color: 'var(--danger, #b42318)', whiteSpace: 'pre-wrap' }}>{error}</p>}
      {!config && !error && <Hint>正在读取配置…</Hint>}
      {config && tab === 'config' && <>
        <ol style={{ lineHeight: 1.9, paddingLeft: 22 }}>
          <li>在飞书打开用于简历库的多维表格，复制网址。支持 <b>/base/</b> 和知识库 <b>/wiki/</b> 链接，没有 <b>table</b> 参数也可以。</li>
          <li>由飞书管理员在 <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">开放平台</a> 创建企业自建应用，取得 App ID 和 App Secret。</li>
          <li>为应用开通多维表格的查看、编辑及字段管理权限；附件需开通“上传图片和附件到云文档中”（docs:document.media:upload）。发布应用，并在目标表格添加该应用为可管理的协作者。知识库链接还需开通知识库节点读取权限，并让应用可访问该节点。若开启高级权限，也须授予应用完整管理范围。</li>
          <li>填入链接和应用凭证后，点击“读取数据表”，选择用作简历库的那张表并保存配置。再“检查连接”和“补齐标准字段”。</li>
        </ol>
        {user?.role === 'founder' ? <>
          <Field label="目标数据表链接"><input type="text" value={form.base_url} disabled={busy} placeholder="粘贴飞书 /base/ 或 /wiki/ 网址，没有 table 参数也可以" onChange={e => changeConfig('base_url', e.target.value)} /></Field>
          <div className="grid g2">
            <Field label="App ID"><input type="text" value={form.app_id} disabled={busy} autoComplete="off" onChange={e => changeConfig('app_id', e.target.value)} /></Field>
            <Field label={config.secret_saved ? 'App Secret（已保存，留空保留）' : 'App Secret'}><input type="password" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', fontSize: 13 }} value={form.app_secret} disabled={busy} autoComplete="new-password" onChange={e => changeConfig('app_secret', e.target.value)} /></Field>
          </div>
          <div className="row"><Btn disabled={busy} onClick={() => run(async () => {
            setConnection(null)
            const value = await resolveFeishuLink(form)
            setConnection(value); setForm(previous => ({ ...previous, table_id: value.selected_table_id }))
          })}>读取数据表</Btn><Hint>只读取表名，不上传人选或简历。</Hint></div>
          {connection && <Field label={`选择目标数据表（已读取 ${connection.tables.length} 张）`}>
            <select value={form.table_id || ''} disabled={busy} onChange={e => { setForm({ ...form, table_id: e.target.value }); setPreview(null); setReport(null) }}>
              <option value="">请选择用于简历库的数据表</option>
              {connection.tables.map(table => <option key={table.table_id} value={table.table_id}>{table.name}</option>)}
            </select>
          </Field>}
          <Btn disabled={busy || (connection && !form.table_id)} onClick={() => run(async () => {
            const value = await saveFeishuConfig({ ...form, resolution_token: connection?.resolution_token })
            setConfig(value); setForm({ base_url: value.base_url, app_id: value.app_id, app_secret: '', table_id: value.table_id })
            setConnection(null); setReport(null); setPreview(null)
          })}>保存配置</Btn>
        </> : <Hint>请让系统管理员保存应用配置。HR 可使用已配置的目标表格进行同步。</Hint>}
        <div className="row">
          <Btn disabled={busy || !config.configured || configChanged} onClick={() => run(async () => {
            const check = await probeFeishu(); setReport(check.fields)
            if (check.attachment_access?.state === 'missing') setError(check.attachment_access.message)
          })}>检查连接</Btn>
          {user?.role === 'founder' && <Btn disabled={busy || !config.configured || configChanged} onClick={() => run(async () => {
            if (!await confirm({ title: '补齐飞书标准字段', message: `将在已保存的飞书目标数据表添加缺少的标准字段。文本列使用多行文本，简历附件使用附件类型。不会发送人选资料。\n${config.base_url}`, confirmLabel: '添加缺少的字段' })) return
            setReport((await initializeFeishuFields()).fields); setPreview(null)
          })}>补齐标准字段</Btn>}
        </div>
        {config.configured && configChanged && <Hint>连接信息已修改，请先保存配置，再检查连接或补齐字段。</Hint>}
        <Hint>凭证只保存在这台 Mac 的受保护数据目录，随本地数据一起备份；页面不回显密钥。升级后保留配置。</Hint>
        <table style={{ marginTop: 14 }}><thead><tr><th>标准字段</th><th>飞书类型</th><th>连接检查</th></tr></thead><tbody>
          {(report || config.fields).map(field => <tr key={field.key}><td>{field.label}</td><td>{field.type === 17 ? '附件' : '多行文本'}</td><td>{stateLabel[field.state] || '待检查'}</td></tr>)}
        </tbody></table>
      </>}
      {config && tab === 'sync' && <>
        <Hint>{config.configured ? <>目标：<a href={config.base_url} target="_blank" rel="noreferrer">打开飞书数据表</a></> : '尚未连接飞书。可以先选择人选并本地预览，建表后再发送。'}</Hint>
        {config.interviews_table_id && <Hint>选择面试时间或面试记录时，会同时更新<a href={config.base_url.replace(/([?&]table=)[^&]+/, '$1' + config.interviews_table_id)} target="_blank" rel="noreferrer">面试安排表</a>：每轮独立一行，可按日期筛选本周面试。</Hint>}
        <p>选择人选（每批最多 20 位）和要上传的附件。个人经历仅使用已保存的资料；解析后未确认的信息不会直接发送。</p>
        <div className="row"><Btn sm disabled={busy} onClick={() => { setSelected(candidates.slice(0, 20).map(c => c.id)); setPreview(null); setResults(null) }}>选择当前列表前 20 位</Btn><Btn sm disabled={busy} onClick={() => { setSelected([]); setPreview(null); setResults(null) }}>清空选择</Btn><span>已选 {selected.length} 位</span></div>
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
          {candidates.map(candidate => <div key={candidate.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
            <label><input type="checkbox" checked={selected.includes(candidate.id)} disabled={busy || (!selected.includes(candidate.id) && selected.length >= 20)} onChange={() => changeSelection(candidate.id)} /> {candidate.name} · {candidate.requisition_title || '未关联岗位'}</label>
            {selected.includes(candidate.id) && <div style={{ paddingLeft: 24 }}>
              {(candidate.resumes || []).map(file => <label key={file.id} style={{ display: 'block', marginTop: 7 }}><input type="checkbox" disabled={busy} checked={(attachments[candidate.id] || []).includes(file.id)} onChange={() => changeFile(candidate.id, file.id)} /> {file.original_name} <small>（{Math.ceil(file.size / 1024)} KB）</small></label>)}
              {!candidate.resumes?.length && <Hint>暂无简历附件，仅同步所选资料。</Hint>}
            </div>}
          </div>)}
          {!candidates.length && <Hint>当前列表没有人选，请先回到简历库建档。</Hint>}
        </div>
        <p>同步字段：</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{config.fields.filter(field => field.key !== 'attachments').map(field => <label key={field.key}>
          <input type="checkbox" checked={fields.includes(field.key)} disabled={busy || field.required} onChange={() => { setFields(previous => previous.includes(field.key) ? previous.filter(key => key !== field.key) : [...previous, field.key]); setPreview(null); setResults(null) }} /> {field.label}{field.required ? '（必选）' : ''}
        </label>)}</div>
        <div className="row"><Btn disabled={busy || !selected.length} onClick={doPreview}>{busy ? '处理中…' : '预览所选资料'}</Btn></div>
        {preview && <>
          <h4>发送预览 · {preview.items.length} 位人选</h4>
          <Hint>所选字段会覆盖飞书对应列，空值也会清空对应列。未选字段、飞书其他协作列及已有附件会保留。删除本地人选或附件不会删除飞书副本。</Hint>
          {preview.issues.length > 0 && <p role="alert">请先在“连接配置”补齐或调整字段：{preview.issues.map(field => field.label).join('、')}。</p>}
          {preview.items.some(item => item.files.length) && preview.attachment_access?.state === 'missing' && <p role="alert" style={{ color: 'var(--bad)', marginTop: 10 }}>{preview.attachment_access.message}</p>}
          <div style={{ overflowX: 'auto', maxHeight: 300, marginTop: 12 }}><table><thead><tr><th>人选</th>{preview.fields.filter(field => !['source_key', 'synced_at'].includes(field.key)).map(field => <th key={field.key}>{field.label}</th>)}<th>所选附件</th></tr></thead><tbody>
            {preview.items.map(item => <tr key={item.id}><td>{item.name}{!item.profile_saved && <Hint>尚未保存详细个人资料</Hint>}</td>{preview.fields.filter(field => !['source_key', 'synced_at'].includes(field.key)).map(field => <td key={field.key} style={{ minWidth: 120, maxWidth: 300, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.values[field.key] || '（空）'}</td>)}<td style={{ minWidth: 180 }}>{item.files.map(file => <div key={file.id}>{file.original_name}</div>)}{!item.files.length && '不新增附件'}</td></tr>)}
          </tbody></table></div>
          <div className="row"><Btn primary disabled={busy || !preview.ready} onClick={doPush}>确认同步到飞书</Btn>{!preview.configured && <Btn disabled={busy} onClick={() => setTab('config')}>先连接飞书</Btn>}</div>
        </>}
        {results && <div role="status">
          <h4>同步完成：成功 {results.filter(item => item.ok).length} 位，失败 {results.filter(item => !item.ok).length} 位</h4>
          {results.map(item => <p key={item.id}>{candidates.find(c => c.id === item.id)?.name || `人选 ${item.id}`}：{item.ok ? <Chip kind="ok">{item.action === 'updated' ? '已更新原记录' : '已新增'}</Chip> : item.error}</p>)}
          {results.some(item => !item.ok) && <Btn disabled={busy} onClick={() => { setSelected(results.filter(item => !item.ok).map(item => item.id)); setResults(null) }}>仅选择失败人选，重新预览</Btn>}
        </div>}
      </>}
      <div className="row" style={{ justifyContent: 'flex-end', position: 'sticky', bottom: -24, padding: '12px 0', background: 'white' }}><Btn disabled={busy} onClick={onClose}>关闭</Btn></div>
    </div>
  </Modal>
}
