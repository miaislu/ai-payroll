import { useEffect, useRef, useState } from 'react'
import { Card, Chip, Hint, Btn, Field } from '../components/ui.jsx'
import { getCandidatesKanban, getRequisitions, createCandidate, setCandidateStage, updateCandidate, getOfferSuggest, getInterviews, createInterview, onboardCandidate, createOfferApproval, uploadCandidateResume, parseCandidateResume, deleteCandidateResume, downloadCandidateResume } from '../api.js'
import { CANDIDATE_STAGES } from '../data.js'

const EMPTY = { name: '', phone: '', email: '', source_channel: '内推', requisition_id: null, stage: 'new', expected_salary: 30000, apply_date: '' }
const fmtMoney = v => v ? '¥' + v.toLocaleString('zh-CN') : '—'

export default function Candidates({ toast, backendUp, goto }) {
  const [kanban, setKanban] = useState(null)
  const [reqs, setReqs] = useState([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [detail, setDetail] = useState(null) // 候选人详情
  const [suggest, setSuggest] = useState(null) // Offer 建议
  const [ivForm, setIvForm] = useState({ round_no: 1, interviewer: '', result: 'pending', score: '', notes: '' })
  const [resumeParsing, setResumeParsing] = useState(false)
  const [resumePreview, setResumePreview] = useState(null) // 解析结果预览
  const resumeRef = useRef(null)

  const load = async () => {
    try {
      setKanban(await getCandidatesKanban())
      setReqs(await getRequisitions())
    } catch { toast('候选人数据加载失败') }
  }
  useEffect(() => { load() }, [backendUp])

  const set = k => e => setForm({ ...form, [k]: ['expected_salary', 'requisition_id'].includes(k) ? +e.target.value : e.target.value })

  const saveNew = async () => {
    if (!form.name.trim()) return toast('候选人姓名必填')
    try {
      await createCandidate({ ...form, apply_date: form.apply_date || new Date().toISOString().slice(0, 10) })
      toast('已添加候选人')
      setAdding(false); setForm(EMPTY); load()
    } catch { toast('添加失败') }
  }

  const move = async (c, dir) => {
    const idx = CANDIDATE_STAGES.findIndex(s => s.key === c.stage)
    const next = CANDIDATE_STAGES[Math.max(0, Math.min(CANDIDATE_STAGES.length - 1, idx + dir))]
    if (next.key === c.stage) return
    const reject_reason = next.key === 'rejected' ? prompt('淘汰原因：') || '' : undefined
    try { await setCandidateStage(c.id, { stage: next.key, reject_reason }); toast(`${c.name} → ${next.label}`); load() }
    catch { toast('流转失败') }
  }

  const openDetail = async c => {
    setDetail(c)
    setSuggest(null)
    if (c.stage === 'offer' && c.requisition_id) {
      const r = reqs.find(x => x.id === c.requisition_id)
      if (r) {
        try {
          const s = await getOfferSuggest({ job_family: r.job_family, annual_cash: (c.offer_amount || c.expected_salary || 0) * 12, city: r.city })
          setSuggest(s)
        } catch { /* 无对标数据忽略 */ }
      }
    }
  }

  const addInterview = async () => {
    if (!detail) return
    try {
      await createInterview({ candidate_id: detail.id, round_no: +ivForm.round_no || 1, interviewer: ivForm.interviewer, interview_date: new Date().toISOString().slice(0, 10), result: ivForm.result, score: ivForm.score === '' ? null : +ivForm.score, notes: ivForm.notes })
      toast('已记录面试')
      setIvForm({ round_no: (detail.interviews?.length || 0) + 1, interviewer: '', result: 'pending', score: '', notes: '' })
      const fresh = await getCandidatesKanban()
      setKanban(fresh)
      const nc = fresh.flatMap(g => g.items).find(x => x.id === detail.id)
      if (nc) setDetail(nc)
    } catch { toast('记录失败') }
  }

  const saveOffer = async () => {
    if (!detail) return
    const amount = prompt('Offer 现金月薪（元）：', detail.offer_amount || detail.expected_salary || '')
    if (!amount) return
    try {
      await updateCandidate(detail.id, { offer_amount: +amount, offer_date: new Date().toISOString().slice(0, 10) })
      toast('Offer 金额已更新；原审批如有已自动失效')
      const fresh = await getCandidatesKanban()
      setKanban(fresh)
      const updated = fresh.flatMap(g => g.items).find(x => x.id === detail.id)
      if (updated) openDetail(updated)
    } catch { toast('更新失败') }
  }

  // 办理入职：生成员工档案 + 自动记录入职事件（招聘 → 员工 闭环）
  const doOnboard = async () => {
    if (!detail) return
    const date = prompt('入职日期（YYYY-MM-DD）：', new Date().toISOString().slice(0, 10))
    if (!date) return
    try {
      const r = await onboardCandidate(detail.id, { onboard_date: date })
      toast(`🎉 ${r.name} 已入职（员工 #${r.employee_id}，${r.hire_month}）`)
      setDetail(null); load()
    } catch (e) { toast(e.message.includes('400') ? '缺少薪资数据，请先填写 Offer 金额' : '入职办理失败') }
  }

  // ── 简历 AI 解析（线索即结构化：技能标签/岗位族/经验年数）──
  const onResumePick = async ev => {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file || !detail) return
    if (file.size > 10 * 1024 * 1024) return toast('文件超过 10MB')
    try {
      await uploadCandidateResume(detail.id, file)
      toast('简历已上传：' + file.name)
      const fresh = await getCandidatesKanban()
      setKanban(fresh)
      setDetail(fresh.flatMap(g => g.items).find(x => x.id === detail.id))
    } catch { toast('上传失败（支持 txt/md/docx/pdf，≤10MB）') }
  }
  const doParseResume = async () => {
    if (!detail) return
    const allowExternal = confirm('是否允许将脱敏后的简历正文发送给已配置的外部 AI？\n选择“取消”将仅使用本地规则解析。')
    setResumeParsing(true)
    try {
      const r = await parseCandidateResume(detail.id, allowExternal)
      setResumePreview(r.parsed)
      toast(`解析完成（${r.engine}）· 岗位族「${r.parsed.job_family || '未知'}」${r.parsed.experience_years ? '· ' + r.parsed.experience_years + ' 年经验' : ''}`)
      const fresh = await getCandidatesKanban()
      setKanban(fresh)
      setDetail(fresh.flatMap(g => g.items).find(x => x.id === detail.id))
    } catch (e) { toast(e.message.includes('400') ? '无法解析该文件（支持 txt/md/docx/pdf）' : '解析失败') } finally { setResumeParsing(false) }
  }
  const doDeleteResume = async () => {
    if (!detail || !confirm('删除该候选人简历？')) return
    try { await deleteCandidateResume(detail.id); toast('已删除'); const fresh = await getCandidatesKanban(); setKanban(fresh); setDetail(fresh.flatMap(g => g.items).find(x => x.id === detail.id)) }
    catch { toast('删除失败') }
  }
  // 发起 Offer 审批（进入审批中心，创始人审批后 offer_status=approved）
  const doOfferApproval = async () => {
    if (!detail) return
    try {
      const r = await createOfferApproval(detail.id, { who: 'HR 李明' })
      toast(`已发起审批：${r.title}`)
      const fresh = await getCandidatesKanban()
      setKanban(fresh)
      setDetail(fresh.flatMap(g => g.items).find(x => x.id === detail.id))
    } catch (e) { toast(e.message.includes('400') ? '请先填写 Offer 金额并处于 Offer 阶段' : '发起失败') }
  }

  const stageLabel = k => CANDIDATE_STAGES.find(s => s.key === k)?.label || k
  const stageColor = k => CANDIDATE_STAGES.find(s => s.key === k)?.color || '#64748b'

  return (
    <>
      <Card title={<>候选人管线 <Chip kind="info">拖拽流转：◀ ▶ 按钮移动阶段</Chip></>}>
        <div className="toolbar">
          <Hint>半导体岗位招聘看板：新简历 → 初筛 → 面试 → Offer → 已入职；Offer 阶段可引用对标带宽出定薪建议</Hint>
          <div style={{ flex: 1 }} />
          <Btn primary onClick={() => setAdding(true)}>+ 添加候选人</Btn>
        </div>

        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
          {kanban?.map(g => (
            <div key={g.stage} style={{ flex: '0 0 230px', background: '#f8fafc', borderRadius: 12, padding: 10, border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: stageColor(g.stage) }} />
                <b style={{ fontSize: 13 }}>{g.label}</b>
                <Chip kind="gray">{g.items.length}</Chip>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.items.map(c => (
                  <div key={c.id} className="card" style={{ margin: 0, padding: 10, cursor: 'pointer' }} onClick={() => openDetail(c)}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                    <div className="hint" style={{ marginTop: 2 }}>{c.requisition_title || '未关联需求'}{c.req_grade ? ' · ' + c.req_grade : ''}</div>
                    <div className="hint">{c.source_channel} · {c.apply_date?.slice(5)}</div>
                    {c.expected_salary && <div style={{ fontSize: 12, marginTop: 4 }}>期望 {fmtMoney(c.expected_salary)}<span style={{ color: 'var(--muted)' }}>/月</span></div>}
                    {c.offer_amount && <div style={{ fontSize: 12, color: '#d97706', fontWeight: 600 }}>Offer {fmtMoney(c.offer_amount)}{c.offer_status === 'approved' ? ' ✅已批' : c.offer_status === 'rejected' ? ' ⛔驳回' : ''}</div>}
                    {c.eval_score && <Chip kind="info">评分 {c.eval_score}</Chip>}
                    {c.skills && <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>{c.skills.split(',').slice(0, 3).filter(Boolean).map(s => <span key={s} className="chip gray" style={{ fontSize: 10, padding: '1px 6px' }}>{s.trim()}</span>)}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      {['screening', 'interview', 'offer'].includes(c.stage) && <Btn sm onClick={e => { e.stopPropagation(); move(c, -1) }}>◀</Btn>}
                      {['new', 'screening', 'interview'].includes(c.stage) && <Btn sm onClick={e => { e.stopPropagation(); move(c, 1) }}>▶</Btn>}
                    </div>
                  </div>
                ))}
                {!g.items.length && <div className="hint" style={{ textAlign: 'center', padding: '10px 0' }}>空</div>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {adding && (
        <div id="modal-bg" className="show" onClick={e => e.target.id === 'modal-bg' && setAdding(false)}>
          <div className="modal" style={{ width: 520 }}>
            <h3>添加候选人</h3>
            <div className="grid g2">
              <Field label="姓名"><input value={form.name} onChange={set('name')} placeholder="必填" /></Field>
              <Field label="来源渠道">
                <select value={form.source_channel} onChange={set('source_channel')}>
                  {['内推', 'BOSS直聘', '猎聘', '猎头', '校园招聘', '官网', '其他'].map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="应聘需求">
                <select value={form.requisition_id || ''} onChange={e => setForm({ ...form, requisition_id: e.target.value ? +e.target.value : null })}>
                  <option value="">— 未关联 —</option>
                  {reqs.filter(r => r.status !== 'closed' && r.status !== 'cancelled').map(r => <option key={r.id} value={r.id}>{r.title}（{r.grade}·{r.city}）</option>)}
                </select>
              </Field>
              <Field label="期望月薪（元）"><input type="number" value={form.expected_salary} onChange={set('expected_salary')} /></Field>
              <Field label="电话"><input value={form.phone} onChange={set('phone')} /></Field>
              <Field label="邮箱"><input value={form.email} onChange={set('email')} /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setAdding(false)}>取消</Btn>
              <Btn primary onClick={saveNew}>添加</Btn>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div id="modal-bg" className="show" onClick={e => e.target.id === 'modal-bg' && setDetail(null)}>
          <div className="modal" style={{ width: 640, maxHeight: '86vh', overflowY: 'auto' }}>
            <h3>{detail.name} <Chip kind="gray" style={{}}>{stageLabel(detail.stage)}</Chip></h3>
            <div className="grid g2" style={{ fontSize: 13 }}>
              <div><span className="hint">应聘需求</span><br />{detail.requisition_title || '—'}</div>
              <div><span className="hint">来源</span><br />{detail.source_channel}</div>
              <div><span className="hint">申请日期</span><br />{detail.apply_date}</div>
              <div><span className="hint">期望月薪</span><br />{fmtMoney(detail.expected_salary)}</div>
              <div><span className="hint">Offer 月薪</span><br /><b style={{ color: '#d97706' }}>{fmtMoney(detail.offer_amount)}</b></div>
              <div><span className="hint">评分</span><br />{detail.eval_score ?? '—'}</div>
            </div>
            {detail.reject_reason && <div className="hint" style={{ marginTop: 8, color: '#dc2626' }}>淘汰原因：{detail.reject_reason}</div>}

            {/* Offer 定薪建议：引用对标带宽 */}
            {suggest && (
              <div style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 12 }}>
                <b style={{ fontSize: 13 }}>🎯 定薪建议（{suggest.job_family} · {suggest.city}）</b>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 8 }}>
                  <div><span className="hint">带宽 P25/P50/P75</span><br /><b>{suggest.adjusted.p25} / {suggest.adjusted.p50} / {suggest.adjusted.p75} 万</b></div>
                  <div><span className="hint">建议区间</span><br /><b>{suggest.suggestion.range}</b></div>
                  <div><span className="hint">当前分位</span><br /><b style={{ color: suggest.current?.positionLabel === '超出带宽' ? '#dc2626' : '#10b981' }}>{suggest.current?.position}%（{suggest.current?.positionLabel}）</b></div>
                </div>
                <div className="hint" style={{ marginTop: 6 }}>{suggest.note}</div>
              </div>
            )}

            {/* 简历与 AI 解析：线索即结构化 */}
            <div style={{ marginTop: 12, background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13 }}>📄 简历与 AI 解析</b>
                {detail.resume_name && <Chip kind="ok">{detail.resume_name}</Chip>}
                {detail.job_family && <Chip kind="info">🏷 {detail.job_family}</Chip>}
                {detail.experience_years != null && <Chip kind="info">{detail.experience_years} 年经验</Chip>}
                <div style={{ flex: 1 }} />
                <input ref={resumeRef} type="file" accept=".txt,.md,.text,.docx,.pdf" style={{ display: 'none' }} onChange={onResumePick} />
                <Btn sm onClick={() => resumeRef.current?.click()}>上传</Btn>
                {detail.resume_name && <Btn sm disabled={resumeParsing} onClick={doParseResume}>{resumeParsing ? '解析中…' : '🤖 AI 解析'}</Btn>}
                {detail.resume_name && <Btn sm onClick={() => downloadCandidateResume(detail.id, detail.resume_name).catch(() => toast('下载失败'))}>下载</Btn>}
                {detail.resume_name && <Btn sm onClick={doDeleteResume}>删除</Btn>}
              </div>
              {detail.skills && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {detail.skills.split(',').filter(Boolean).map(s => <span key={s} className="chip gray" style={{}}>{s.trim()}</span>)}
                </div>
              )}
              {!detail.resume_name && <div className="hint" style={{ marginTop: 6 }}>上传简历后 AI 自动提取：基本信息 / 教育 / 工作经历 / 技能标签 / 岗位族 / 经验年数</div>}
            </div>

            {/* 面试记录 */}
            <h4 style={{ marginTop: 14 }}>面试记录（{(detail.interviews || []).length} 轮）</h4>
            {(detail.interviews || []).map(iv => (
              <div key={iv.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '6px 0', fontSize: 13 }}>
                <b>R{iv.round_no}</b> · {iv.interviewer} · {iv.interview_date}
                <Chip kind={iv.result === 'pass' ? 'ok' : iv.result === 'fail' ? 'warn' : 'gray'} style={{ marginLeft: 6 }}>{iv.result === 'pass' ? '通过' : iv.result === 'fail' ? '不通过' : '待定'}</Chip>
                {iv.score != null && <Chip kind="info" style={{ marginLeft: 6 }}>评分 {iv.score}</Chip>}
                {iv.notes && <div className="hint">{iv.notes}</div>}
              </div>
            ))}
            {detail.stage === 'interview' && (
              <div style={{ border: '1px dashed var(--line)', borderRadius: 8, padding: 10, marginTop: 8 }}>
                <div className="grid g2">
                  <Field label="轮次"><input type="number" value={ivForm.round_no} onChange={e => setIvForm({ ...ivForm, round_no: +e.target.value })} /></Field>
                  <Field label="面试官"><input value={ivForm.interviewer} onChange={e => setIvForm({ ...ivForm, interviewer: e.target.value })} /></Field>
                  <Field label="结果">
                    <select value={ivForm.result} onChange={e => setIvForm({ ...ivForm, result: e.target.value })}>
                      <option value="pending">待定</option><option value="pass">通过</option><option value="fail">不通过</option>
                    </select>
                  </Field>
                  <Field label="评分（0-100）"><input type="number" value={ivForm.score} onChange={e => setIvForm({ ...ivForm, score: e.target.value })} /></Field>
                </div>
                <Field label="评价"><input value={ivForm.notes} onChange={e => setIvForm({ ...ivForm, notes: e.target.value })} /></Field>
                <div className="row">
                  <Btn sm onClick={addInterview}>+ 记录本轮面试</Btn>
                </div>
              </div>
            )}

            <div className="row">
              {detail.stage === 'offer' && (
                <>
                  {detail.offer_status === 'approved'
                    ? <Chip kind="ok">✅ Offer 已批准（可办理入职）</Chip>
                    : detail.offer_status === 'rejected'
                      ? <Chip kind="bad">Offer 已驳回</Chip>
                      : <Btn onClick={doOfferApproval}>📋 发起 Offer 审批</Btn>}
                  {detail.offer_status === 'approved' && <Btn primary style={{ background: '#10b981', borderColor: '#10b981' }} onClick={doOnboard}>🚀 办理入职（生成员工档案）</Btn>}
                </>
              )}
              {detail.stage === 'hired' && <Btn primary onClick={() => goto('employees')}>已入职 · 查看员工档案 →</Btn>}
              {detail.stage !== 'hired' && detail.stage !== 'rejected' && detail.stage !== 'withdrawn' && (
                <>
                  <Btn onClick={saveOffer}>💼 更新 Offer</Btn>
                  {detail.stage !== 'offer' && <Btn primary onClick={async () => { await setCandidateStage(detail.id, { stage: 'offer' }); toast('已进入 Offer 阶段'); load(); openDetail({ ...detail, stage: 'offer' }) }}>发 Offer</Btn>}
                </>
              )}
              <Btn onClick={() => setDetail(null)}>关闭</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 简历解析结果预览 */}
      {resumePreview && (
        <div id="modal-bg" className="show" onClick={e => e.target.id === 'modal-bg' && setResumePreview(null)}>
          <div className="modal" style={{ width: 620, maxHeight: '86vh', overflowY: 'auto' }}>
            <h3>🤖 AI 解析结果 · {detail?.name}</h3>
            {resumePreview.engine && <Hint>解析引擎：{resumePreview.engine}{resumePreview.job_family ? ` · 岗位族「${resumePreview.job_family}」` : ''}{resumePreview.experience_years != null ? ` · ${resumePreview.experience_years} 年经验` : ''}</Hint>}
            <div className="nav-sep" style={{ padding: '10px 0 4px' }}>基本信息</div>
            <div className="grid g2" style={{ fontSize: 13 }}>
              {Object.entries(resumePreview.basic || {}).filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><span className="hint">{k}</span><br /><b>{String(v)}</b></div>
              ))}
            </div>
            <div className="nav-sep" style={{ padding: '10px 0 4px' }}>教育经历（{(resumePreview.education || []).length}）</div>
            {(resumePreview.education || []).map((x, i) => (
              <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '5px 0', fontSize: 13 }}>
                <b>{x.school}</b> <Chip kind="info">{x.qualification || ''}</Chip>
                <span className="hint">{x.major ? ' · ' + x.major : ''}{x.graduation_year ? ' · ' + x.graduation_year + ' 年' : ''}</span>
              </div>
            ))}
            <div className="nav-sep" style={{ padding: '10px 0 4px' }}>工作经历（{(resumePreview.work_experience || []).length}）</div>
            {(resumePreview.work_experience || []).map((x, i) => (
              <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '5px 0', fontSize: 13 }}>
                <b>{x.company}</b>{x.title ? ' · ' + x.title : ''}
                <span className="hint">{x.start_date ? ' · ' + x.start_date + ' ~ ' + (x.end_date || '至今') : ''}{x.note ? ' · ' + String(x.note).slice(0, 40) : ''}</span>
              </div>
            ))}
            <div className="row">
              <Btn onClick={() => setResumePreview(null)}>关闭</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
