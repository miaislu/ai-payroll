import { Btn, Chip, Hint, Modal } from './ui.jsx'
import { useEffect, useState } from 'react'
import { getResumeParserStatus } from '../api.js'

export const RESUME_FIELD_LABELS = {
  name: '姓名', gender: '性别', date_of_birth: '出生日期', marital_status: '婚姻状况', nationality: '民族',
  education_level: '最高学历', mobile: '手机号', phone: '电话', personal_email: '邮箱', current_address: '现居地址', skills: '技能'
}

export function resumeEngineInfo(engine = '') {
  const key = String(engine || '')
  if (key.startsWith('rules-fallback')) return { label: '基础规则提取（模型未成功）', kind: 'warn', description: '本次模型解析未成功，结果来自规则提取，请重点核对漏项。' }
  if (key.startsWith('rules') || key === 'rule') return { label: '基础规则提取', kind: 'gray', description: '本次使用关键词和格式规则提取，不包含大模型理解。复杂排版、项目经历和任职时间可能有遗漏。' }
  if (key.startsWith('local-llm') || key.startsWith('llm-local')) return { label: '本地模型解析', kind: 'ok', description: '本次由本地模型生成结构化结果，请对照原文核对后应用。' }
  if (key.startsWith('llm')) return { label: 'AI 模型解析', kind: 'info', description: '本次由模型生成结构化结果，请核对后应用。' }
  return { label: '解析方式未记录', kind: 'gray', description: '这份历史结果未记录解析方式，请对照原始简历核对。' }
}

export function readResumeResult(value) {
  if (!value) return null
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

function useParserStatus() {
  const [status, setStatus] = useState(null)
  const [checking, setChecking] = useState(true)
  const refresh = async () => {
    setChecking(true)
    try { setStatus(await getResumeParserStatus()) }
    catch (error) { setStatus({ available: false, message: error.message }) }
    finally { setChecking(false) }
  }
  useEffect(() => { let active = true; getResumeParserStatus()
    .then(value => { if (active) setStatus(value) })
    .catch(error => { if (active) setStatus({ available: false, message: error.message }) })
    .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [])
  return { status, checking, refresh }
}

export function ResumeParsingStatus() {
  const { status, checking, refresh } = useParserStatus()
  return <div className="resume-parser-status">
    <div><Chip kind={status?.available ? 'ok' : 'warn'}>本地模型：{checking ? '检查中' : status?.available ? (status.busy ? '解析中' : '可用') : '暂不可用'}</Chip><Chip kind="gray">基础规则提取：可用</Chip><Btn sm disabled={checking} onClick={refresh}>刷新状态</Btn></div>
    <Hint>{status?.message || '正在检查本机模型服务…'}</Hint>
  </div>
}

export function ResumeParsingDialog({ filename, busy, onClose, onBasicParse, onModelParse }) {
  const { status, checking, refresh } = useParserStatus()
  const [method, setMethod] = useState('')
  const [error, setError] = useState('')
  const run = async (mode, action) => {
    setError(''); setMethod(mode)
    try { await action() } catch (failure) { setError(failure.message) }
  }
  return <Modal onClose={busy ? undefined : onClose}>
    <div className="modal resume-parser-dialog" role="dialog" aria-modal="true" aria-labelledby="resume-parser-title">
      <h3 id="resume-parser-title">选择简历解析方式</h3>
      <Hint style={{ marginBottom: 14, overflowWrap: 'anywhere' }}>文件：{filename || '已上传的简历'}</Hint>
      <div className="grid g2">
        <div className="resume-method model">
          <div className="resume-method-title">本地模型解析 <Chip kind={status?.available ? 'ok' : 'warn'}>{checking ? '检查中' : status?.available ? '可用' : '暂不可用'}</Chip></div>
          <p>使用本机 8B 模型理解简历，整理教育经历、任职记录与技能。</p>
          <Hint>{status?.message || '正在检查本机服务…'}</Hint>
          <Btn primary disabled={busy || checking || !status?.available || status?.busy} onClick={() => run('local_model', onModelParse)}>{busy && method === 'local_model' ? '模型正在理解简历…' : '开始本地模型解析'}</Btn>
          <Btn sm disabled={busy || checking} onClick={refresh}>重新检查</Btn>
        </div>
        <div className="resume-method">
          <div className="resume-method-title">基础规则提取 <Chip kind="ok">可用</Chip></div>
          <p>通过关键词和固定格式识别部分字段，适合先提取联系方式、学历与技能。</p>
          <Hint>复杂经历可能漏项；扫描件和图片中的文字暂不识别。</Hint>
          <Btn disabled={busy} onClick={() => run('rules', onBasicParse)}>{busy && method === 'rules' ? '正在进行基础提取…' : '开始基础提取'}</Btn>
        </div>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red, #b42318)' }}>解析失败：{error}</p>}
      <Hint style={{ marginTop: 14 }}>{busy ? (method === 'local_model' ? '正在本机处理，可能需要几分钟。长简历会分段解析，请保持页面打开。' : '正在读取文件并提取内容，请稍候。') : '两种方式均在此 Mac 处理，不会向外部 AI 服务发送简历。扫描件和图片暂不支持识别。'}</Hint>
      <div className="row"><Btn disabled={busy} onClick={onClose}>取消</Btn></div>
    </div>
  </Modal>
}

export function ResumeResultSummary({ parsed, engine }) {
  const info = resumeEngineInfo(parsed?.engine || engine)
  const basicCount = Object.values(parsed?.basic || {}).filter(value => value != null && value !== '').length
  return <div className="resume-result-summary">
    <div className="resume-result-title"><Chip kind={info.kind}>{info.label}</Chip>{parsed?.model && <Hint>模型：{parsed.model}</Hint>}</div>
    <p>{info.description}</p>
    {parsed?.duration_ms && <Hint>本次用时 {Math.round(parsed.duration_ms / 1000)} 秒{parsed.chunks > 1 ? `，共处理 ${parsed.chunks} 个片段` : ''}</Hint>}
    <div className="grid g3">
      <div><b>{basicCount}</b><span>项基本信息</span></div>
      <div><b>{parsed?.education?.length || 0}</b><span>段教育经历</span></div>
      <div><b>{parsed?.work_experience?.length || 0}</b><span>段工作经历</span></div>
    </div>
  </div>
}
