import { useEffect, useRef, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getCandidatesKanban, getRequisitions, getChannels, createCandidate, createCandidateFromResume, setCandidateStage, updateCandidate, getOfferSuggest, createInterview, updateInterview, onboardCandidate, createOfferApproval, uploadCandidateResume, parseCandidateResume, applyCandidateResume, getCandidateResumeResult, deleteCandidateResume, downloadCandidateResume } from '../api.js'
import { CANDIDATE_STAGES, INTERVIEW_RATINGS, interviewRating, candidateStatusLabel, INTERVIEW_STATUS_LABELS } from '../data.js'
import { useDialog } from '../components/DialogProvider.jsx'
import { currentDate } from '../lib/period.js'
import { EXPECTED_SALARY_RANGES, expectedSalaryRange, expectedSalaryLabel, exactExpectedSalary, expectedAnnualSalaryLabel } from '../lib/candidate-salary.js'
import { ResumeParsingStatus, ResumeParsingDialog, ResumeResultSummary, RESUME_FIELD_LABELS,
  readResumeResult, resumeEngineInfo } from '../components/ResumeParsing.jsx'
import { ResumeProfileDetails, ResumeProfileEditor } from '../components/ResumeProfile.jsx'
import { mergeResumeProfile } from '../lib/resume-profile.js'
import RequisitionMatcher from '../components/RequisitionMatcher.jsx'
import FeishuSync from '../components/FeishuSync.jsx'
import { deleteCandidate, getDeletedCandidates, restoreDeletedCandidate } from '../api.js'
import { interviewOutcomeLabel } from '../lib/interview-outcome.js'

const EMPTY = { name: '', phone: '', email: '', source_channel: '内推', source_channel_id: null, requisition_id: null, stage: 'new', expected_salary_range: 'none', expected_salary_annual: '', apply_date: '' }
const LEGACY_SOURCES = ['内推', '官网', '其他']
const fmtMoney = v => v ? '¥' + v.toLocaleString('zh-CN') : '—'
const nextInterviewRound = candidate => Math.max(0, ...(candidate.interviews || []).map(item => Number(item.round_no))) + 1
const latestInterview = candidate => [...(candidate.interviews || [])].sort((a, b) =>
  (b.interview_date || '').localeCompare(a.interview_date || '') || b.round_no - a.round_no || b.id - a.id)[0]
const sourceValue = item => item.source_channel_id ? `channel:${item.source_channel_id}` : `legacy:${item.source_channel || '内推'}`
const sourcePatch = (value, channels) => {
  if (value.startsWith('channel:')) {
    const channel = channels.find(item => item.id === Number(value.slice(8)))
    return { source_channel_id: channel?.id || null, source_channel: channel?.name || '其他' }
  }
  return { source_channel_id: null, source_channel: value.slice(7) || '其他' }
}

export default function Candidates({ toast, backendUp, goto, candidateId, user }) {
  const { confirm: askConfirm, prompt: askPrompt } = useDialog()
  const [kanban, setKanban] = useState(null)
  const [reqs, setReqs] = useState([])
  const [channels, setChannels] = useState([])
  const [adding, setAdding] = useState(false)
  const [feishuOpen, setFeishuOpen] = useState(false)
  const [deletedRecords, setDeletedRecords] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [restoringId, setRestoringId] = useState(null)
  const [importFiles, setImportFiles] = useState([])
  const [importPrimary, setImportPrimary] = useState(0)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [profileForm, setProfileForm] = useState(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMatching, setProfileMatching] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [detail, setDetail] = useState(null) // 候选人详情
  const [suggest, setSuggest] = useState(null) // Offer 建议
  const [suggestUnavailable, setSuggestUnavailable] = useState('')
  const [ivForm, setIvForm] = useState({ round_no: 1, interviewer: '', interview_date: currentDate(), status: 'scheduled', result: 'pending', notes: '' })
  const [resumeParsing, setResumeParsing] = useState(false)
  const [resumeUploading, setResumeUploading] = useState(false)
  const [parseDialog, setParseDialog] = useState(false)
  const [resumePreview, setResumePreview] = useState(null) // 解析结果预览
  const resumeRef = useRef(null)

  const load = async () => {
    try {
      const [candidateGroups, requisitions, recruitmentChannels] = await Promise.all([getCandidatesKanban(), getRequisitions(), getChannels()])
      setKanban(candidateGroups)
      setReqs(requisitions)
      setChannels(recruitmentChannels)
    } catch { toast('候选人数据加载失败') }
  }
  useEffect(() => { load() }, [backendUp])

  const set = k => e => setForm({ ...form, [k]: ['expected_salary', 'requisition_id'].includes(k) ? +e.target.value : e.target.value })

  const saveNew = async () => {
    if (adding === 'manual' && !form.name.trim()) return toast('候选人姓名必填')
    if (adding === 'upload' && !importFiles.length) return toast('请选择简历文件')
    if (adding === 'upload' && importFiles.length > 10) return toast('每次最多上传 10 个文件')
    if (adding === 'upload' && importFiles.some(file => file.size > 10 * 1024 * 1024)) return toast('每个文件不能超过 10MB')
    if (creating) return
    setCreating(true)
    try {
      const payload = { ...form, apply_date: form.apply_date || currentDate() }
      const created = adding === 'upload' ? await createCandidateFromResume(importFiles, { ...payload, primary_index: importPrimary }) : await createCandidate(payload)
      toast(created.warning || (adding === 'upload' ? '已建档并完成基础规则提取，请核对资料' : '已建立人选档案'))
      setAdding(false); setForm(EMPTY); setImportFiles([]); setImportPrimary(0)
      await load()
      goto('candidates', created.id)
    } catch (error) { toast('建档失败：' + error.message) } finally { setCreating(false) }
  }

  const changeStage = async stage => {
    if (!detail) return
    const reject_reason = stage === 'rejected'
      ? await askPrompt({ title: '淘汰候选人', message: '已发生的面试记为完成，当前轮次未填写结论时记为未通过；已有面评保留。尚未进行的未来面试安排会取消。', label: '淘汰原因', required: true, confirmLabel: '确认淘汰' })
      : undefined
    if (stage === 'rejected' && reject_reason === null) return
    if (stage === 'accepted' && !await askConfirm({ title: '确认录用', message: `确认录用 ${detail.name}？录用后可从新增员工页面关联建档。`, confirmLabel: '确认录用' })) return
    try { await setCandidateStage(detail.id, { stage, reject_reason }); toast('已更新状态并记录流转'); await load() }
    catch (error) { toast(error.message) }
  }

  const removeCandidate = async () => {
    if (!detail || deleting) return
    if (!await askConfirm({ title: '删除候选人', message: `删除 ${detail.name}（档案 #${detail.id}，${detail.phone || '未留电话'}）？将从本地简历库移除，简历附件、面试记录和资料保留，可在“已删除”中恢复。已有飞书记录保留。`, confirmLabel: '删除候选人' })) return
    setDeleting(true)
    try {
      await deleteCandidate(detail.id)
      setDetail(null); goto('candidates'); await load(); toast('已删除，可在“已删除”中恢复')
    } catch (error) { toast(error.message) }
    finally { setDeleting(false) }
  }

  const showDeleted = async () => {
    try { setDeletedRecords(await getDeletedCandidates()) } catch (error) { toast(error.message) }
  }

  const restoreRecord = async record => {
    if (restoringId != null) return
    setRestoringId(record.id)
    try {
      await restoreDeletedCandidate(record.id)
      setDeletedRecords(await getDeletedCandidates()); await load(); toast(`已恢复 ${record.name}`)
    } catch (error) { toast(error.message) }
    finally { setRestoringId(null) }
  }

  const openDetail = async c => {
    setDetail(c)
    setIvForm({ round_no: nextInterviewRound(c), interviewer: '', interview_date: currentDate(), status: 'scheduled', result: 'pending', notes: '' })
    setSuggest(null)
    setSuggestUnavailable(c.stage === 'offer' ? '正在查询同口径已审批带宽…' : '')
    if (c.stage === 'offer' && c.requisition_id) {
      const r = reqs.find(x => x.id === c.requisition_id)
      if (r) {
        try {
          const annualMonths = Number(r.fixed_salary_months ?? 12) + Number(r.annual_bonus_months ?? 0)
          const s = await getOfferSuggest({ job_family: r.job_family, annual_cash: (c.offer_amount || exactExpectedSalary(c)) * annualMonths, city: r.city })
          setSuggest(s)
          setSuggestUnavailable('')
        } catch {
          setSuggestUnavailable('暂无同口径已审批带宽。请结合招聘需求预算、候选人期望与面试记录人工判断；未核验带宽不会用于定薪。')
        }
      }
    } else if (c.stage === 'offer') {
      setSuggestUnavailable('候选人尚未关联招聘需求，无法匹配岗位和城市口径。')
    }
  }

  useEffect(() => {
    if (!candidateId) { setDetail(null); return }
    if (!kanban) return
    const candidate = kanban.flatMap(group => group.items).find(item => item.id === candidateId)
    if (candidate) openDetail(candidate)
    else { setDetail(null); toast('未找到该候选人') }
  }, [candidateId, kanban])

  const addInterview = async () => {
    if (!detail) return
    if (!ivForm.interviewer.trim() || !ivForm.interview_date) return toast('请填写面试官和面试日期')
    try {
      await createInterview({ ...ivForm, candidate_id: detail.id, round_no: +ivForm.round_no || 1 })
      toast(ivForm.status === 'scheduled' ? '已安排面试并记录流转' : '已记录面试')
      const fresh = await getCandidatesKanban()
      setKanban(fresh)
      const nc = fresh.flatMap(g => g.items).find(x => x.id === detail.id)
      if (nc) setDetail(nc)
    } catch (error) { toast('记录失败：' + error.message) }
  }

  const saveOffer = async () => {
    if (!detail) return
    const amount = await askPrompt({
      title: '更新 Offer', label: '现金月薪（元）', inputType: 'number', min: 1,
      defaultValue: detail.offer_amount || exactExpectedSalary(detail) || '', required: true,
      message: '修改金额会使原有待审批记录自动失效。', confirmLabel: '保存金额'
    })
    if (amount === null) return
    try {
      await updateCandidate(detail.id, { offer_amount: +amount, offer_date: new Date().toISOString().slice(0, 10) })
      toast('Offer 金额已更新；原审批如有已自动失效')
      const fresh = await getCandidatesKanban()
      setKanban(fresh)
      const updated = fresh.flatMap(g => g.items).find(x => x.id === detail.id)
      if (updated) openDetail(updated)
    } catch { toast('更新失败') }
  }

  const changeDetailSource = async value => {
    if (!detail) return
    try {
      await updateCandidate(detail.id, sourcePatch(value, channels))
      const fresh = await getCandidatesKanban()
      setKanban(fresh)
      const updated = fresh.flatMap(group => group.items).find(item => item.id === detail.id)
      if (updated) setDetail(updated)
      toast('候选人来源渠道已更新')
    } catch { toast('来源渠道更新失败') }
  }

  // 办理入职：生成员工档案 + 自动记录入职事件（招聘 → 员工 闭环）
  const doOnboard = async () => {
    if (!detail) return
    const date = await askPrompt({ title: '关联建立员工档案', label: '入职日期', inputType: 'date', defaultValue: currentDate(), required: true, confirmLabel: '保存建档' })
    if (date === null) return
    try {
      const r = await onboardCandidate(detail.id, { onboard_date: date })
      toast(`🎉 ${r.name} 已入职（员工 #${r.employee_id}，${r.hire_month}）`)
      await load()
      goto('employee-profile', r.employee_id)
    } catch (e) { toast('建档失败：' + e.message) }
  }

  // ── 简历 AI 解析（线索即结构化：技能标签/岗位族/经验年数）──
  const onResumePick = async ev => {
    const files = [...(ev.target.files || [])]
    ev.target.value = ''
    if (!files.length || !detail) return
    if (files.length > 10) return toast('每次最多上传 10 个文件')
    if (files.some(file => file.size > 10 * 1024 * 1024)) return toast('每个文件不能超过 10MB')
    setResumeUploading(true)
    try {
      await uploadCandidateResume(detail.id, files)
      toast(`已新增 ${files.length} 份附件，原文件已保留`)
      const fresh = await getCandidatesKanban()
      setKanban(fresh)
      setDetail(fresh.flatMap(g => g.items).find(x => x.id === detail.id))
    } catch (error) { toast('上传失败：' + error.message) } finally { setResumeUploading(false) }
  }
  const doParseResume = async (mode = 'rules') => {
    if (!detail || resumeParsing) return
    setResumeParsing(true)
    try {
      const r = await parseCandidateResume(detail.id, mode, parseDialog)
      setResumePreview({ ...r.parsed, result_token: r.result_token, resume_id: r.resume_id, filename: r.filename })
      setParseDialog(false)
      toast((mode === 'local_model' ? '本地模型解析' : '基础提取') + '已完成，请核对结果')
      const fresh = await getCandidatesKanban()
      setKanban(fresh)
      setDetail(fresh.flatMap(g => g.items).find(x => x.id === detail.id))
    } catch (e) { throw e } finally { setResumeParsing(false) }
  }
  const doPreviewResume = async file => {
    try { const result = await getCandidateResumeResult(detail.id, file.id); setResumePreview({ ...result.parsed, resume_id: file.id, result_token: result.result_token, filename: result.filename }) }
    catch (error) { toast(error.message) }
  }
  const doDeleteResume = async file => {
    if (!detail || !await askConfirm({ title: '删除这份简历附件', message: `仅删除「${file.original_name}」及它的解析结果，其他附件和已保存的个人资料保留。`, confirmLabel: '删除此文件' })) return
    try { await deleteCandidateResume(detail.id, file.id); toast('已删除此附件'); const fresh = await getCandidatesKanban(); setKanban(fresh); setDetail(fresh.flatMap(g => g.items).find(x => x.id === detail.id)) }
    catch { toast('删除失败') }
  }
  // 发起 Offer 审批（进入审批中心，HR 或 CEO 同意后 offer_status=approved）
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
  const allCandidates = kanban?.flatMap(group => group.items) || []
  const visibleCandidates = allCandidates.filter(item => (!stageFilter || item.stage === stageFilter)
    && (!search || [item.name, item.requisition_title, item.source_channel, item.skills].some(value => String(value || '').toLowerCase().includes(search.toLowerCase()))))
  const detailReq = detail ? reqs.find(r => r.id === detail.requisition_id) : null
  const detailFeeSalary = Number(detail?.offer_amount || exactExpectedSalary(detail))
  const detailFeeEstimate = detail?.linked_channel_type === 'headhunter' && detailFeeSalary && detail.fee_basis_months && detail.fee_rate != null
    ? Math.round(detailFeeSalary * Number(detail.fee_basis_months) * Number(detail.fee_rate) / 100)
    : null

  return (
    <>
      <Card title={<>简历库 <Chip kind="info">{allCandidates.length} 位人选</Chip></>}>
        <div className="toolbar">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索姓名、应聘岗位、渠道或技能" aria-label="搜索简历" />
          <div style={{ flex: 1 }} />
          <Btn onClick={() => setFeishuOpen(true)}>同步到飞书</Btn>
          <Btn onClick={showDeleted}>已删除</Btn>
          <Btn primary onClick={() => { setForm(EMPTY); setImportFiles([]); setImportPrimary(0); setAdding('choice') }}>+ 添加候选人</Btn>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <Btn sm primary={!stageFilter} onClick={() => setStageFilter('')}>全部 {allCandidates.length}</Btn>
          {kanban?.map(group => <Btn sm key={group.stage} primary={stageFilter === group.stage} onClick={() => setStageFilter(group.stage)}>{group.label} {group.items.length}</Btn>)}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table><thead><tr><th>姓名 / 简历</th><th>应聘岗位</th><th>渠道</th><th>期望年薪</th><th>当前状态</th><th>最近面试</th><th>建档日期</th><th>操作</th></tr></thead>
            <tbody>{visibleCandidates.map(candidate => {
              const latest = latestInterview(candidate)
              return <tr key={candidate.id}>
                <td><b>{candidate.name}</b><div className="hint">{candidate.resumes?.length ? `${candidate.resumes.length} 份附件 · ${candidate.resume_name || '待选择解析文件'}` : '暂无简历附件'}</div></td>
                <td>{candidate.requisition_title || '未关联需求'}</td><td>{candidate.source_channel || '—'}</td><td>{expectedAnnualSalaryLabel(candidate)}</td>
                <td><Chip kind={['accepted', 'hired'].includes(candidate.stage) ? 'ok' : candidate.stage === 'rejected' ? 'bad' : 'info'}>{candidateStatusLabel(candidate)}</Chip></td>
                <td>{latest ? <><div>第 {latest.round_no} 轮 · {latest.interview_date}</div><div className="hint">{interviewOutcomeLabel(latest)}</div></> : '尚未安排'}</td>
                <td>{candidate.apply_date || candidate.created_at?.slice(0, 10)}</td>
                <td><Btn sm onClick={() => goto('candidates', candidate.id)}>查看 / 流转</Btn></td>
              </tr>
            })}</tbody>
          </table>
          {!visibleCandidates.length && <Hint>暂无匹配的人选，可上传简历或手动录入建档。</Hint>}
        </div>
      </Card>

      {feishuOpen && <FeishuSync candidates={visibleCandidates} user={user} onClose={() => setFeishuOpen(false)} />}
      {deletedRecords !== null && <Modal onClose={() => setDeletedRecords(null)}>
        <div className="modal" style={{ width: 700 }}>
          <h3>已删除的候选人</h3>
          <Hint>恢复后会保留原档案编号、资料、简历附件和面试记录。</Hint>
          <table><thead><tr><th>候选人</th><th>删除时间</th><th>操作</th></tr></thead><tbody>
            {deletedRecords.map(record => <tr key={record.id}><td>{record.name}（#{record.candidate_id}）</td><td>{new Date(record.deleted_at).toLocaleString('zh-CN')}</td><td><Btn disabled={restoringId != null} onClick={() => restoreRecord(record)}>{restoringId === record.id ? '恢复中…' : '恢复'}</Btn></td></tr>)}
          </tbody></table>
          {!deletedRecords.length && <Hint>暂无已删除记录。</Hint>}
          <div className="row"><Btn onClick={() => setDeletedRecords(null)}>关闭</Btn></div>
        </div>
      </Modal>}
      {adding && (
        <Modal onClose={() => setAdding(false)}>
          <div className="modal" style={{ width: 620, maxHeight: '88vh', overflowY: 'auto' }}>
            <h3>{adding === 'choice' ? '添加候选人' : adding === 'upload' ? '上传简历建档' : '手动录入建档'}</h3>
            {adding === 'choice' ? <>
              <div className="grid g2">
                <Btn primary onClick={() => setAdding('upload')}>直接上传简历</Btn>
                <Btn onClick={() => setAdding('manual')}>手动输入</Btn>
              </div>
              <Hint style={{ marginTop: 12 }}>上传后先做基础规则提取并保存原始简历。建档后可在「选择解析方式」中使用本地模型整理完整经历，核对后补充资料。</Hint>
              <div className="row"><Btn onClick={() => setAdding(false)}>取消</Btn></div>
            </> : <>
            {adding === 'upload' && <>
              <Field label="同一人选的简历附件（每次最多10个，每个≤10MB）">
                <input type="file" multiple accept=".txt,.md,.text,.docx,.pdf,.xlsx,.xls" onChange={e => { setImportFiles([...(e.target.files || [])]); setImportPrimary(0) }} />
              </Field>
              {importFiles.length > 0 && <Field label="建档时用于基础提取的文件"><select value={importPrimary} onChange={e => setImportPrimary(Number(e.target.value))}>
                {importFiles.map((file, index) => <option key={index} value={index}>{index + 1}. {file.name}</option>)}
              </select></Field>}
              <Hint>这些文件会保存在同一人选下。建档后可另选任意一份进行模型解析。</Hint>
            </>}
            <div className="grid g2">
              <Field label={adding === 'upload' ? '姓名（可选，留空自动提取）' : '姓名'}><input value={form.name} onChange={set('name')} placeholder={adding === 'upload' ? '自动提取后可修改' : '必填'} /></Field>
              <Field label="来源渠道">
                <select value={sourceValue(form)} onChange={e => setForm({ ...form, ...sourcePatch(e.target.value, channels) })}>
                  <optgroup label="已建招聘渠道">
                    {channels.map(channel => <option key={channel.id} value={`channel:${channel.id}`}>{channel.type === 'headhunter' ? '猎头 · ' : ''}{channel.name}</option>)}
                  </optgroup>
                  <optgroup label="未建渠道的来源">
                    {LEGACY_SOURCES.map(name => <option key={name} value={`legacy:${name}`}>{name}</option>)}
                  </optgroup>
                </select>
              </Field>
              <Field label="应聘需求">
                <select value={form.requisition_id || ''} onChange={e => setForm({ ...form, requisition_id: e.target.value ? +e.target.value : null })}>
                  <option value="">— 未关联 —</option>
                  {reqs.filter(r => r.status !== 'closed' && r.status !== 'cancelled').map(r => <option key={r.id} value={r.id}>{r.title}（{r.job_family}·{r.city}）</option>)}
                </select>
              </Field>
              <Field label="期望月薪"><select value={form.expected_salary_range} onChange={set('expected_salary_range')}>
                {EXPECTED_SALARY_RANGES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select></Field>
              <Field label="期望年薪（元/年）"><input type="number" min="0" step="1" value={form.expected_salary_annual} onChange={set('expected_salary_annual')} placeholder="例如1200000" /></Field>
              <Field label="电话"><input value={form.phone} onChange={set('phone')} /></Field>
              <Field label="邮箱"><input value={form.email} onChange={set('email')} /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setAdding('choice')}>返回</Btn>
              <Btn primary disabled={creating} onClick={saveNew}>{creating ? '正在建档…' : '保存建档'}</Btn>
            </div>
            </>}
          </div>
        </Modal>
      )}

      {detail && (
        <Modal onClose={() => goto('candidates')}>
          <div className="modal" style={{ width: 640, maxHeight: '86vh', overflowY: 'auto' }}>
            <h3>{detail.name} <Chip kind="gray">{candidateStatusLabel(detail)}</Chip></h3>
            <div className="grid g2" style={{ fontSize: 13 }}>
              <div><span className="hint">应聘需求</span><br />{detail.requisition_title || '—'}</div>
              <div><span className="hint">来源渠道</span><br />
                <select value={sourceValue(detail)} onChange={e => changeDetailSource(e.target.value)} style={{ marginTop: 3 }}>
                  <optgroup label="已建招聘渠道">
                    {channels.map(channel => <option key={channel.id} value={`channel:${channel.id}`}>{channel.type === 'headhunter' ? '猎头 · ' : ''}{channel.name}</option>)}
                  </optgroup>
                  <optgroup label="未建渠道的来源">
                    {[...new Set([...LEGACY_SOURCES, detail.source_channel])].map(name => <option key={name} value={`legacy:${name}`}>{name}</option>)}
                  </optgroup>
                </select>
              </div>
              <div><span className="hint">申请日期</span><br />{detail.apply_date}</div>
              <div><span className="hint">期望月薪</span><br />{expectedSalaryLabel(detail)}</div>
              <div><span className="hint">期望年薪</span><br />{expectedAnnualSalaryLabel(detail)}</div>
              <div><span className="hint">Offer 月薪</span><br /><b style={{ color: '#d97706' }}>{fmtMoney(detail.offer_amount)}</b></div>
              <div><span className="hint">评分</span><br />{detail.eval_score ?? '—'}</div>
              <div><span className="hint">需求预算</span><br />{detailReq?.salary_min || detailReq?.salary_max ? `${fmtMoney(detailReq.salary_min)} – ${fmtMoney(detailReq.salary_max)}/月` : '—'}</div>
              <div><span className="hint">需求口径</span><br />{detailReq ? `${detailReq.job_family || '—'} · ${detailReq.city || '—'}` : '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <Btn sm onClick={() => setProfileForm({ personal_profile: detail.personal_profile, expected_salary_range: expectedSalaryRange(detail), expected_salary_annual: detail.expected_salary_annual ?? '', requisition_id: detail.requisition_id || '' })}>编辑个人信息</Btn>
              {['new', 'rejected', 'withdrawn'].includes(detail.stage) && <Btn sm onClick={() => changeStage('screening')}>进入初筛</Btn>}
              <Btn sm disabled={deleting || Boolean(detail.employee_id)} onClick={removeCandidate}>{deleting ? '删除中…' : '删除候选人'}</Btn>
              {detail.stage === 'interview' && <Btn sm onClick={() => changeStage('offer')}>进入 Offer 阶段</Btn>}
              {!['hired', 'rejected', 'withdrawn', 'accepted'].includes(detail.stage) && <Btn sm onClick={() => changeStage('rejected')}>淘汰人选</Btn>}
              {!['hired', 'withdrawn', 'rejected'].includes(detail.stage) && <Btn sm onClick={() => changeStage('withdrawn')}>人选放弃</Btn>}
            </div>
            <ResumeProfileDetails value={detail.personal_profile} />
            <details style={{ marginTop: 14 }} open>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>流转记录（{detail.timeline?.length || 0} 条）</summary>
              <div style={{ maxHeight: 220, overflowY: 'auto', borderLeft: '2px solid var(--line)', marginTop: 8, paddingLeft: 12 }}>
                {[...(detail.timeline || [])].reverse().map(event => <div key={event.id} style={{ padding: '7px 0', fontSize: 12, borderBottom: '1px solid var(--line)' }}>
                  <b>{event.from_stage ? `${stageLabel(event.from_stage)} → ` : ''}{event.to_stage ? stageLabel(event.to_stage) : event.note || '记录更新'}{event.round_no ? ` · 第 ${event.round_no} 轮` : ''}</b>
                  {event.to_stage && event.note && <div>{event.note}</div>}
                  <div className="hint">{new Date(event.occurred_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} · {event.actor}</div>
                </div>)}
                {!detail.timeline?.length && <Hint>暂无流转记录。</Hint>}
              </div>
            </details>
            {detail?.linked_channel_type === 'headhunter' && (
              <div style={{ marginTop: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: 10, fontSize: 13 }}>
                <b>猎头关联：{detail.linked_channel_name}</b>
                <div className="hint" style={{ marginTop: 3 }}>
                  计费依据 {detail.fee_basis_months || '—'} 个月月薪 × {detail.fee_rate ?? '—'}%
                  {detailFeeEstimate != null ? `；按${detail.offer_amount ? 'Offer' : '期望'}月薪预计费用 ${fmtMoney(detailFeeEstimate)}` : '；费用条件尚未完整'}
                  {detail.guarantee_months != null ? `；保证期 ${detail.guarantee_months} 个月` : ''}
                </div>
              </div>
            )}
            {detail.reject_reason && <div className="hint" style={{ marginTop: 8, color: '#dc2626' }}>淘汰原因：{detail.reject_reason}</div>}

            {/* Offer 参考：只展示已审批的原始基准，不做无来源系数外推 */}
            {suggest && (
              <div style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 12 }}>
                <b style={{ fontSize: 13 }}>🎯 已审批参考带宽（{suggest.job_family}）</b>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 8 }}>
                  <div><span className="hint">基准口径</span><br /><b>{suggest.scope}</b></div>
                  <div><span className="hint">P25/P50/P75</span><br /><b>{suggest.baseline.p25} / {suggest.baseline.p50} / {suggest.baseline.p75} 万</b></div>
                  <div><span className="hint">相对基准位置</span><br /><b style={{ color: suggest.current?.positionLabel === '超出带宽' ? '#dc2626' : '#10b981' }}>{suggest.current?.position ?? '—'}{suggest.current?.position != null ? `%（${suggest.current.positionLabel}）` : ''}</b></div>
                </div>
                <div className="hint" style={{ marginTop: 6 }}>{suggest.note}</div>
              </div>
            )}
            {!suggest && suggestUnavailable && (
              <div style={{ marginTop: 12, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: 12 }}>
                <b style={{ fontSize: 13 }}>暂无线性可用的定薪带宽</b>
                <Hint style={{ marginTop: 4 }}>{suggestUnavailable}</Hint>
              </div>
            )}

            {/* 简历与 AI 解析：线索即结构化 */}
            <div style={{ marginTop: 12, background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13 }}>📄 简历与解析</b>
                <Chip kind="gray">{detail.resumes?.length || 0} 份附件</Chip>
                {detail.job_family && <Chip kind="info">🏷 {detail.job_family}</Chip>}
                {detail.experience_years != null && <Chip kind="info">{detail.experience_years} 年经验</Chip>}
                <div style={{ flex: 1 }} />
                <input ref={resumeRef} type="file" multiple accept=".txt,.md,.text,.docx,.pdf,.xlsx,.xls" style={{ display: 'none' }} onChange={onResumePick} />
                <Btn sm disabled={resumeUploading || resumeParsing} onClick={() => resumeRef.current?.click()}>{resumeUploading ? '上传中…' : '添加简历文件'}</Btn>
                {detail.resumes?.length > 0 && <Btn sm disabled={resumeParsing || resumeUploading} onClick={() => setParseDialog(detail.resume_source_id || detail.resumes[0].id)}>{resumeParsing ? '解析中…' : '选择文件解析'}</Btn>}
              </div>
              <Hint>可保存多份简历或不同版本；上传新文件会保留已有附件。每次最多上传10个，每个≤10MB。</Hint>
              {(detail.resumes || []).map((file, index) => <div key={file.id} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: 10, marginTop: 8 }}>
                <b style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{index + 1}. {file.original_name}</b>
                <div style={{ marginTop: 4 }}><Chip kind={file.has_parsed ? 'ok' : 'gray'}>{file.has_parsed ? resumeEngineInfo(file.parse_engine).label : '待解析'}</Chip>
                  {detail.resume_applied_id === file.id && detail.resume_applied_hash === file.result_token && <Chip kind="info">个人信息来源</Chip>}
                  <Hint>{file.size ? `${Math.ceil(file.size / 1024)} KB · ` : ''}{new Date(file.uploaded_at).toLocaleString('zh-CN')}</Hint>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <Btn sm disabled={resumeParsing || resumeUploading} aria-label={`解析：${file.original_name}`} onClick={() => setParseDialog(file.id)}>解析此文件</Btn>
                  {file.has_parsed && <Btn sm disabled={resumeParsing} aria-label={`查看结果：${file.original_name}`} onClick={() => doPreviewResume(file)}>查看结果</Btn>}
                  <Btn sm aria-label={`下载：${file.original_name}`} onClick={() => downloadCandidateResume(detail.id, file.id, file.original_name).catch(() => toast('下载失败'))}>下载</Btn>
                  <Btn sm disabled={resumeParsing || resumeUploading} aria-label={`删除：${file.original_name}`} onClick={() => doDeleteResume(file)}>删除此文件</Btn>
                </div>
              </div>)}
              <ResumeParsingStatus />
              {detail.resume_pending && <div style={{ marginTop: 8, color: '#92400e' }}>简历已解析，尚未更新个人信息。点击对应文件的「查看结果」，核对后确认更新个人信息与岗位。</div>}
              {readResumeResult(detail.resume_parsed) && <Hint>最近一次解析：{detail.resume_name} · {resumeEngineInfo(readResumeResult(detail.resume_parsed)?.engine).label}</Hint>}
              {detail.skills && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {detail.skills.split(',').filter(Boolean).map(s => <span key={s} className="chip gray" style={{}}>{s.trim()}</span>)}
                </div>
              )}
              {!detail.resume_name && <div className="hint" style={{ marginTop: 6 }}>支持 txt/md/docx/pdf/xlsx/xls，≤10MB。上传后可选择基础提取，也可直接手动补充资料。</div>}
            </div>

            {/* 面试记录 */}
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h4>面试记录（{(detail.interviews || []).length} 轮）</h4>
              <Btn sm onClick={() => goto('interviews', detail.id)}>查看 / 编辑全部面评 →</Btn>
            </div>
            {(detail.interviews || []).map(iv => (
              <div key={iv.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '6px 0', fontSize: 13 }}>
                <b>R{iv.round_no}</b> · {iv.interviewer} · {iv.interview_date}
                <Chip kind={iv.status === 'completed' ? interviewRating(iv.result).kind : 'info'}>{interviewOutcomeLabel(iv)}</Chip>
                {iv.notes && <div className="hint">{iv.notes}</div>}
                {iv.status === 'scheduled' && <Btn sm onClick={async () => {
                  try { await updateInterview(iv.id, { status: 'in_progress' }); await load(); toast('已开始本轮面试') } catch (error) { toast(error.message) }
                }}>开始本轮面试</Btn>}
              </div>
            ))}
            {!['accepted', 'hired', 'rejected', 'withdrawn'].includes(detail.stage) && (
              <div style={{ border: '1px dashed var(--line)', borderRadius: 8, padding: 10, marginTop: 8 }}>
                <h4 style={{ marginBottom: 8 }}>安排面试 / 补录面评</h4>
                <div className="grid g2">
                  <Field label="轮次"><input type="number" value={ivForm.round_no} onChange={e => setIvForm({ ...ivForm, round_no: +e.target.value })} /></Field>
                  <Field label="面试官"><input value={ivForm.interviewer} onChange={e => setIvForm({ ...ivForm, interviewer: e.target.value })} /></Field>
                  <Field label="面试日期"><input type="date" value={ivForm.interview_date} onChange={e => setIvForm({ ...ivForm, interview_date: e.target.value })} /></Field>
                  <Field label="面试状态"><select value={ivForm.status} onChange={e => setIvForm({ ...ivForm, status: e.target.value })}>
                    <option value="scheduled">待面试（安排日期）</option><option value="in_progress">本轮面试中</option><option value="completed">已完成（补录面评）</option>
                  </select></Field>
                  {ivForm.status === 'completed' && <Field label="评分">
                    <select value={ivForm.result} onChange={e => setIvForm({ ...ivForm, result: e.target.value })}>
                      {INTERVIEW_RATINGS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                    </select>
                  </Field>}
                </div>
                <Field label="面评"><textarea rows={6} value={ivForm.notes} onChange={e => setIvForm({ ...ivForm, notes: e.target.value })} placeholder="记录能力表现、优势、风险点和录用建议" /></Field>
                <div className="row">
                  <Btn sm onClick={addInterview}>{ivForm.status === 'scheduled' ? '+ 保存面试安排' : '+ 记录本轮面试'}</Btn>
                </div>
              </div>
            )}

            <div className="row">
              {detail.stage === 'offer' && (
                <>
                  {detail.offer_status === 'approved'
                    ? <Chip kind="ok">✅ Offer 已批准（可确认录用）</Chip>
                    : detail.offer_status === 'rejected'
                      ? <Chip kind="bad">Offer 已驳回</Chip>
                      : <Btn onClick={doOfferApproval}>📋 发起 Offer 审批</Btn>}
                  {detail.offer_status === 'approved' && <Btn primary onClick={() => changeStage('accepted')}>确认录用</Btn>}
                </>
              )}
              {detail.stage === 'accepted' && <>
                <Btn primary onClick={doOnboard}>关联建立员工档案</Btn>
                <Hint>也可到“员工档案 → 新增员工”选择本位已录用人选。</Hint>
              </>}
              {detail.stage === 'hired' && detail.employee_id && <Btn primary onClick={() => goto('employee-profile', detail.employee_id)}>查看关联员工档案 →</Btn>}
              {detail.stage !== 'hired' && detail.stage !== 'rejected' && detail.stage !== 'withdrawn' && (
                <>
                  <Btn onClick={saveOffer}>💼 更新 Offer</Btn>
                </>
              )}
              <Btn onClick={() => goto('candidates')}>关闭</Btn>
            </div>
          </div>
        </Modal>
      )}

      {profileForm && detail && <Modal onClose={profileSaving ? undefined : () => setProfileForm(null)}>
        <div className="modal" style={{ width: 720, maxHeight: '86vh', overflowY: 'auto' }}>
          <h3>{profileForm.fromResume ? '核对并更新个人信息' : '编辑个人信息'}</h3>
          {profileForm.fromResume && <Hint>下列资料优先采用本次识别结果，可直接修改。确认后更新姓名、联系方式、学历、技能及全部经历；未识别到的信息保留原值。</Hint>}
          <RequisitionMatcher candidateId={detail.id} profile={profileForm.personal_profile} selectedId={profileForm.requisition_id}
            auto={profileForm.fromResume && !detail.requisition_id} disabled={profileSaving} onBusyChange={setProfileMatching}
            onSelect={value => setProfileForm(current => ({ ...current, requisition_id: value, requisitionTouched: true }))}
            onReady={value => setProfileForm(current => current && !current.requisition_id && !current.requisitionTouched && value.suggested_requisition_id
              ? { ...current, requisition_id: String(value.suggested_requisition_id) } : current)} />
          <Field label="关联岗位（招聘需求）"><select value={profileForm.requisition_id || ''} disabled={profileSaving}
            onChange={event => setProfileForm({ ...profileForm, requisition_id: event.target.value, requisitionTouched: true })}>
            <option value="">— 暂不关联 —</option>{reqs.filter(item => ['open', 'interview'].includes(item.status) || item.id === Number(profileForm.requisition_id))
              .map(item => <option key={item.id} value={item.id}>{item.title} · {item.city}{['open', 'interview'].includes(item.status) ? '' : '（当前关联，已非在招）'}</option>)}
          </select></Field>
          {detail.requisition_id && <Hint>已保留当前关联岗位；如需调整，可选择其他岗位并确认保存。</Hint>}
          <ResumeProfileEditor value={profileForm.personal_profile} onChange={value => setProfileForm({ ...profileForm, personal_profile: value })} />
          {!profileForm.fromResume && <>
          <div className="grid g2">
            <Field label="期望年薪（元/年）"><input type="number" min="0" step="1" value={profileForm.expected_salary_annual ?? ''} onChange={e => setProfileForm({ ...profileForm, expected_salary_annual: e.target.value })} placeholder="保留年薪，不自动折算月薪" /></Field>
            <Field label="期望月薪"><select value={profileForm.expected_salary_range} onChange={e => setProfileForm({ ...profileForm, expected_salary_range: e.target.value })}>
              {EXPECTED_SALARY_RANGES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select></Field>
          </div>
          </>}
          {profileForm.error && <p role="alert" style={{ color: '#b42318' }}>{profileForm.error}</p>}
          <div className="row resume-review-actions"><Btn disabled={profileSaving} onClick={() => setProfileForm(null)}>取消</Btn><Btn primary disabled={profileSaving || profileMatching} onClick={async () => {
            if (profileSaving || profileMatching) return
            setProfileSaving(true)
            try {
              if (profileForm.fromResume) await applyCandidateResume(detail.id, { personal_profile: profileForm.personal_profile, result_token: profileForm.result_token, resume_id: profileForm.resume_id,
                requisition_id: profileForm.requisition_id ? Number(profileForm.requisition_id) : null })
              else {
                const basic = profileForm.personal_profile.basic
                await updateCandidate(detail.id, { ...profileForm, name: basic.name, phone: basic.mobile, email: basic.personal_email,
                  requisition_id: profileForm.requisition_id ? Number(profileForm.requisition_id) : null })
              }
              setProfileForm(null); await load(); toast('个人信息、经历和关联岗位已保存')
            } catch (error) { setProfileForm(current => ({ ...current, error: error.message })) }
            finally { setProfileSaving(false) }
          }}>{profileSaving ? '正在保存…' : profileMatching ? '岗位匹配中…' : profileForm.fromResume ? '确认更新个人信息与岗位' : '保存个人信息与岗位'}</Btn></div>
        </div>
      </Modal>}

      {parseDialog && detail && <ResumeParsingDialog filename={detail.resumes?.find(file => file.id === parseDialog)?.original_name} busy={resumeParsing}
        files={detail.resumes} selectedId={parseDialog} onSelectFile={setParseDialog}
        onClose={() => setParseDialog(false)} onBasicParse={() => doParseResume('rules')} onModelParse={() => doParseResume('local_model')} />}

      {/* 简历解析结果预览 */}
      {resumePreview && (
        <Modal onClose={() => setResumePreview(null)}>
          <div className="modal" style={{ width: 620, maxHeight: '86vh', overflowY: 'auto' }}>
            <h3>提取结果核对 · {detail?.name}</h3>
            <Hint>来源文件：{resumePreview.filename || detail?.resume_name}</Hint>
            <Hint>识别结果尚不会自动覆盖个人资料。核对后点击下方按钮，进入确认更新。</Hint>
            <ResumeResultSummary parsed={resumePreview} />
            <div className="nav-sep" style={{ padding: '10px 0 4px' }}>基本信息</div>
            <div className="grid g2" style={{ fontSize: 13 }}>
              {Object.entries(resumePreview.basic || {}).filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><span className="hint">{RESUME_FIELD_LABELS[k] || k}</span><br /><b>{Array.isArray(v) ? v.join('、') : String(v)}</b></div>
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
                <span className="hint">{x.start_date ? ' · ' + x.start_date + ' ~ ' + (x.end_date || '至今') : ''}</span>
                {x.note && <div className="hint" style={{ whiteSpace: 'pre-wrap', marginTop: 5 }}>{x.note}</div>}
              </div>
            ))}
            <div className="row resume-review-actions">
              <Btn onClick={() => setResumePreview(null)}>关闭</Btn>
              {detail && <Btn primary onClick={() => {
                setProfileForm({ personal_profile: mergeResumeProfile(detail.personal_profile, resumePreview), fromResume: true,
                  result_token: resumePreview.result_token || detail.resume_result_token, resume_id: resumePreview.resume_id || detail.resume_source_id, requisition_id: detail.requisition_id || '' })
                setResumePreview(null)
              }}>核对并更新个人信息</Btn>}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
