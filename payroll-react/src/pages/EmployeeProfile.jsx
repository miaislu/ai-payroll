import { useEffect, useRef, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { maskPii } from '../lib/format.js'
import {
  getEmployeeProfile, updateEmployeeProfile,
  createEmergencyContact, deleteEmergencyContact,
  createEducation, deleteEducation,
  createWorkExperience, deleteWorkExperience,
  createFamily, deleteFamily,
  getResumes, uploadResume, parseResume, applyResume, deleteResume, downloadResume
} from '../api.js'
import { useDialog } from '../components/DialogProvider.jsx'
import { JOB_CATALOG, SPECIAL_DEDUCTIONS, parseSpecialDeductions } from '../jobCatalog.js'
import { ResumeParsingStatus, ResumeParsingDialog, ResumeResultSummary, RESUME_FIELD_LABELS, resumeEngineInfo, readResumeResult } from '../components/ResumeParsing.jsx'
import { ResumeProfileEditor } from '../components/ResumeProfile.jsx'

const MARITAL = ['已婚', '未婚', '离异', '其他']
const GENDERS = ['男', '女', '其他']
const CONTRACT_TYPES = ['固定期限', '无固定期限', '实习', '劳务', '其他']
const EDUCATIONS = ['博士', '硕士', '本科', '大专', '其他']
const NATIONS = ['汉族', '回族', '满族', '壮族', '其他']
const RELATIONS = ['父亲', '母亲', '配偶', '子女', '兄弟姐妹', '朋友', '其他']
const FAMILY_RELATIONS = ['配偶', '儿子', '女儿', '父亲', '母亲', '其他']

// 基本信息 + 联系方式 + 合同社保 编辑表单字段
const EDIT_GROUPS = [
  { title: '基本信息', fields: [
    ['gender', '性别', 'select', GENDERS], ['date_of_birth', '出生日期', 'date'],
    ['marital_status', '婚姻状况', 'select', MARITAL], ['nationality', '民族', 'select', NATIONS],
    ['education_level', '最高学历', 'select', EDUCATIONS], ['id_number', '证件号码', 'text']
  ]},
  { title: '联系方式', fields: [
    ['mobile', '手机号', 'text'], ['personal_email', '个人邮箱', 'text'],
    ['alternate_mobile', '备用电话', 'text'], ['current_address', '现居地址', 'text'],
    ['permanent_address', '户籍地址', 'text']
  ]},
  { title: '合同与社保', fields: [
    ['contract_type', '合同类型', 'select', CONTRACT_TYPES], ['contract_start', '合同开始', 'date'],
    ['contract_end', '合同结束', 'date'], ['probation_end', '试用期至', 'date'],
    ['confirmation_date', '转正日期', 'date'], ['social_security_no', '社保号', 'text'],
    ['housing_fund_no', '公积金号', 'text'], ['bank_name', '开户银行', 'text'],
    ['bank_account', '银行卡号', 'text'], ['notice_period', '离职通知期', 'text']
  ]},
  { title: '技能标签', fields: [['skills', '技能（逗号分隔）', 'text']] }
]

const EMPTY_CONTACT = { name: '', relation: '配偶', mobile: '', address: '', is_primary: 0 }
const EMPTY_EDU = { school: '', qualification: '本科', major: '', graduation_year: '', note: '' }
const EMPTY_WORK = { company: '', title: '', start_date: '', end_date: '', note: '' }
const EMPTY_FAMILY = { name: '', relation: '配偶', note: '' }

function InfoRow({ label, value }) {
  return (
    <div style={{ padding: '6px 0', fontSize: 13, display: 'flex', gap: 8, borderBottom: '1px solid #f8fafc' }}>
      <span style={{ width: 84, color: 'var(--muted)', flexShrink: 0 }}>{label}</span>
      <span>{value || '—'}</span>
    </div>
  )
}

function SecretRow({ label, value }) {
  const [show, setShow] = useState(false)
  const raw = value || ''
  return (
    <div style={{ padding: '6px 0', fontSize: 13, display: 'flex', gap: 8, borderBottom: '1px solid #f8fafc', alignItems: 'center' }}>
      <span style={{ width: 84, color: 'var(--muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1 }}>{raw ? (show ? raw : maskPii(raw)) : '—'}</span>
      {raw ? <Btn sm onClick={() => setShow(s => !s)}>{show ? '隐藏' : '显示'}</Btn> : null}
    </div>
  )
}

function Section({ title, children, extra }) {
  return (
    <Card title={<>{title}{extra}</>} style={{ marginTop: 14 }}>
      {children}
    </Card>
  )
}

export default function EmployeeProfile({ empId, goto, toast, backendUp }) {
  const { confirm: askConfirm } = useDialog()
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [adding, setAdding] = useState(null) // 'contact' | 'edu' | 'work' | 'family'
  const [addForm, setAddForm] = useState({})
  // 简历与 AI 解析
  const [resumes, setResumes] = useState([])
  const [parsing, setParsing] = useState(null) // 正在解析的 rid
  const [parseTarget, setParseTarget] = useState(null)
  const [preview, setPreview] = useState(null) // 解析结果预览 {rid, parsed, name}
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const load = async () => {
    if (!empId) return
    try {
      const [p, r] = await Promise.all([getEmployeeProfile(empId), getResumes(empId)])
      setData(p); setResumes(r)
    } catch { toast('档案加载失败') }
  }
  useEffect(() => { load() }, [empId, backendUp])

  const openEdit = () => {
    const e = data?.employee || {}
    const f = {}
    EDIT_GROUPS.flatMap(g => g.fields).forEach(([k]) => { f[k] = e[k] || '' })
    setForm(f); setEditing(true)
  }
  const saveEdit = async () => {
    try {
      await updateEmployeeProfile(empId, form)
      toast('档案已保存')
      setEditing(false); load()
    } catch { toast('保存失败') }
  }
  const openAdd = kind => { setAdding(kind); setAddForm({ ...(kind === 'contact' ? EMPTY_CONTACT : kind === 'edu' ? EMPTY_EDU : kind === 'work' ? EMPTY_WORK : EMPTY_FAMILY) }) }
  const saveAdd = async () => {
    const kind = adding
    try {
      if (kind === 'contact') { if (!addForm.name) return toast('联系人姓名必填'); await createEmergencyContact(empId, addForm) }
      else if (kind === 'edu') { if (!addForm.school) return toast('学校必填'); await createEducation(empId, addForm) }
      else if (kind === 'work') { if (!addForm.company) return toast('公司必填'); await createWorkExperience(empId, addForm) }
      else { if (!addForm.name) return toast('姓名必填'); await createFamily(empId, addForm) }
      toast('已添加'); setAdding(null); load()
    } catch { toast('添加失败') }
  }
  const del = async (kind, id) => {
    if (!await askConfirm({ title: '删除档案记录', message: '删除后无法从当前页面恢复。', confirmLabel: '删除' })) return
    try {
      if (kind === 'contact') await deleteEmergencyContact(id)
      else if (kind === 'edu') await deleteEducation(id)
      else if (kind === 'work') await deleteWorkExperience(id)
      else await deleteFamily(id)
      toast('已删除'); load()
    } catch { toast('删除失败') }
  }

  // ── 简历与 AI 解析 ──
  const onPickFile = async ev => {
    const files = [...(ev.target.files || [])]
    ev.target.value = ''
    if (!files.length) return
    if (files.length > 10) return toast('每次最多上传 10 个文件')
    if (files.some(file => file.size > 10 * 1024 * 1024)) return toast('每个文件不能超过 10MB')
    setUploading(true)
    try {
      await uploadResume(empId, files)
      toast(`已保存 ${files.length} 份简历附件`)
      load()
    } catch (error) { toast('上传失败：' + error.message) } finally { setUploading(false) }
  }
  const doParse = async (rid, mode = 'rules') => {
    if (parsing) return
    setParsing(rid)
    try {
      const r = await parseResume(empId, rid, mode)
      const name = resumes.find(x => x.id === rid)?.original_name || '简历'
      setPreview({ rid, name, parsed: r.parsed, engine: r.engine, result_token: r.result_token })
      setParseTarget(null)
      toast((mode === 'local_model' ? '本地模型解析' : '基础提取') + '已完成，请核对后应用')
      load()
    } catch (e) { throw e } finally { setParsing(null) }
  }
  const doApply = async () => {
    if (!preview) return
    if (!await askConfirm({ title: '更新员工个人信息', message: '确认后将更新已识别的个人信息与对应经历。' + (preview.replaceExperience ? '你已选择用本次结果替换现有教育和工作经历；原记录会保存在应用历史中。' : '同一段经历会更新，其他已有经历保留。') + '未识别到的个人字段保留原值。', confirmLabel: '确认写入' })) return
    try {
      const r = await applyResume(empId, preview.rid, { result_token: preview.result_token, personal_profile: preview.edited || preview.parsed, replace_experience: preview.replaceExperience === true })
      toast(`已应用：基础 ${r.applied.basic} · 教育 ${r.applied.education} · 工作经历 ${r.applied.work_experience}`)
      setPreview(null); load()
    } catch (error) { toast('更新失败：' + error.message) }
  }
  const doDeleteResume = async rid => {
    if (!await askConfirm({ title: '删除简历附件', message: '删除后附件及对应解析结果将被移除。', confirmLabel: '删除' })) return
    try { await deleteResume(empId, rid); toast('已删除'); load() } catch { toast('删除失败') }
  }

  if (!data) return <Card><Hint>档案加载中…</Hint></Card>
  const e = data.employee
  const statusChip = e.status === 'departed' ? <Chip kind="warn">离职</Chip> : e.status === 'offer' ? <Chip kind="info">发offer</Chip> : <Chip kind="ok">在职</Chip>
  const age = e.date_of_birth ? Math.floor((Date.now() - new Date(e.date_of_birth)) / 31557600000) : null
  const deductionItems = parseSpecialDeductions(e.special_deductions_json, e.special_deduction)
  const deductionText = SPECIAL_DEDUCTIONS.filter(def => deductionItems[def.key]?.enabled)
    .map(def => `${def.label} ¥${Number(deductionItems[def.key].amount || 0).toLocaleString('zh-CN')}${def.annual ? '/年' : '/月'}`).join('；')

  return (
    <>
      {/* 头部 */}
      <div className="toolbar">
        <Btn sm onClick={() => goto('employees')}>← 返回员工列表</Btn>
        <div style={{ flex: 1 }} />
        <span className="chip info">👤 {e.name}</span>
        <span className="chip info">{e.job_family}</span>
        {statusChip}
      </div>

      {data.recruitment_candidate && <Card title="简历库关联">
        <Hint>来自人选：{data.recruitment_candidate.name} · {data.recruitment_candidate.source_channel || '其他'}。可在本档案上传最新简历、编辑基础信息和补充教育 / 工作经历。</Hint>
        <Btn sm onClick={() => goto('candidates', data.recruitment_candidate.id)}>查看人选及流转记录</Btn>
      </Card>}

      <div className="grid g2" style={{ marginTop: 4 }}>
        <Section title="基本信息" extra={<Btn sm onClick={openEdit}>✏️ 编辑</Btn>}>
          <InfoRow label="姓名" value={e.name} />
          <InfoRow label="用工类型" value={e.employment_type === 'consultant' ? '顾问（劳务报酬 · 不缴社保公积金）' : e.employment_type === 'intern' ? '实习生（工资薪金 · 不缴社保公积金）' : '正式员工'} />
          <InfoRow label="性别" value={e.gender} />
          <InfoRow label="出生日期" value={e.date_of_birth + (age != null ? `（${age} 岁）` : '')} />
          <InfoRow label="婚姻状况" value={e.marital_status} />
          <InfoRow label="民族" value={e.nationality} />
          <InfoRow label="最高学历" value={e.education_level} />
          <SecretRow label="证件号码" value={e.id_number} />
          <InfoRow label="技能" value={e.skills} />
        </Section>

        <Section title="联系方式" extra={<Btn sm onClick={openEdit}>✏️ 编辑</Btn>}>
          <SecretRow label="手机号" value={e.mobile} />
          <SecretRow label="个人邮箱" value={e.personal_email} />
          <SecretRow label="备用电话" value={e.alternate_mobile} />
          <InfoRow label="现居地址" value={e.current_address} />
          <InfoRow label="户籍地址" value={e.permanent_address} />
        </Section>
      </div>

      <Section title="岗位与薪酬约定">
        <div className="grid g2">
          <InfoRow label="岗位分类" value={`${JOB_CATALOG[e.category]?.label || '技术'} / ${e.job_family}`} />
          <InfoRow label="月薪" value={e.monthly_base != null ? `¥${Number(e.monthly_base).toLocaleString('zh-CN')}` : '—'} />
          <InfoRow label="固定薪资" value={`${Number(e.fixed_salary_months ?? 12)} 个月`} />
          <InfoRow label="年终奖约定" value={`${Number(e.annual_bonus_months ?? 0)} 个月`} />
          <InfoRow label="目标年现金" value={`¥${Math.round(Number(e.monthly_base || 0) * (Number(e.fixed_salary_months ?? 12) + Number(e.annual_bonus_months ?? 0))).toLocaleString('zh-CN')}`} />
          <InfoRow label="专项扣除" value={deductionText || '未勾选'} />
        </div>
      </Section>

      <div className="grid g2">
        <Section title="合同与社保" extra={<Btn sm onClick={openEdit}>✏️ 编辑</Btn>}>
          <InfoRow label="合同类型" value={e.contract_type} />
          <InfoRow label="合同期限" value={e.contract_start && e.contract_end ? `${e.contract_start} ~ ${e.contract_end}` : (e.contract_start || e.contract_end)} />
          <InfoRow label="试用期至" value={e.probation_end} />
          <InfoRow label="转正日期" value={e.confirmation_date} />
          <SecretRow label="社保号" value={e.social_security_no} />
          <SecretRow label="公积金号" value={e.housing_fund_no} />
          <InfoRow label="补充公积金" value={e.supplemental_fund_rate > 0 ? (e.supplemental_fund_rate * 100).toFixed(0) + '%（个人 + 单位同比例）' : '未缴'} />
          <InfoRow label="开户银行" value={e.bank_name} />
          <SecretRow label="银行卡号" value={e.bank_account} />
          <InfoRow label="离职通知期" value={e.notice_period} />
        </Section>

        <Section title="紧急联系人" extra={<Btn sm onClick={() => openAdd('contact')}>+ 添加</Btn>}>
          {data.emergency_contacts.length ? data.emergency_contacts.map(c => (
            <div key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '6px 0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <b>{c.name}</b>{c.is_primary ? <Chip kind="warn">主</Chip> : null}
              <span className="hint">{c.relation} · {c.mobile ? maskPii(c.mobile) : ''} · {c.address || ''}</span>
              <span style={{ marginLeft: 'auto', color: '#dc2626', cursor: 'pointer' }} onClick={() => del('contact', c.id)}>✕</span>
            </div>
          )) : <Hint>暂无紧急联系人</Hint>}
        </Section>
      </div>

      <div className="grid g2">
        <Section title="教育经历" extra={<Btn sm onClick={() => openAdd('edu')}>+ 添加</Btn>}>
          {data.education.length ? data.education.map(x => (
            <div key={x.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '6px 0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <b>{x.school}</b><Chip kind="info">{x.qualification}</Chip>
              <span className="hint">{x.major} · {x.graduation_year} 年{x.note ? ' · ' + x.note : ''}</span>
              <span style={{ marginLeft: 'auto', color: '#dc2626', cursor: 'pointer' }} onClick={() => del('edu', x.id)}>✕</span>
            </div>
          )) : <Hint>暂无教育经历</Hint>}
        </Section>

        <Section title="工作经历" extra={<Btn sm onClick={() => openAdd('work')}>+ 添加</Btn>}>
          {data.work_experience.length ? data.work_experience.map(x => (
            <div key={x.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '6px 0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <b>{x.company}</b>
              <span className="hint">{x.title} · {x.start_date}~{x.end_date || '至今'}{x.note ? ' · ' + x.note : ''}</span>
              <span style={{ marginLeft: 'auto', color: '#dc2626', cursor: 'pointer' }} onClick={() => del('work', x.id)}>✕</span>
            </div>
          )) : <Hint>暂无工作经历</Hint>}
        </Section>
      </div>

      <Section title="家庭信息" extra={<Btn sm onClick={() => openAdd('family')}>+ 添加</Btn>} style={{ marginTop: 14 }}>
        {data.family.length ? data.family.map(x => (
          <div key={x.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '6px 0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <b>{x.name}</b><span className="hint">{x.relation}{x.note ? ' · ' + x.note : ''}</span>
            <span style={{ marginLeft: 'auto', color: '#dc2626', cursor: 'pointer' }} onClick={() => del('family', x.id)}>✕</span>
          </div>
        )) : <Hint>暂无家庭信息</Hint>}
      </Section>

      {/* 简历附件 + AI 解析（上传 → 解析 → 预览确认 → 一键应用） */}
      <Section title={<>简历与解析 <Chip kind="info">{resumes.length} 份</Chip></>} style={{ marginTop: 14 }}>
        <ResumeParsingStatus />
        <div className="toolbar">
          <Hint>支持 txt/md/docx/pdf/xlsx/xls，≤10MB。上传简历 → 选择提取方式 → 核对结果 → 确认应用到档案。</Hint>
          <div style={{ flex: 1 }} />
          <input ref={fileRef} type="file" multiple accept=".txt,.md,.text,.docx,.pdf,.xlsx,.xls" style={{ display: 'none' }} onChange={onPickFile} />
          <Btn primary disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? '上传中…' : '📄 上传简历'}</Btn>
        </div>
        {resumes.length ? (
          <table>
            <thead><tr><th>文件名</th><th>大小</th><th>上传时间</th><th>解析状态</th><th>操作</th></tr></thead>
            <tbody>{resumes.map(r => (
              <tr key={r.id}>
                <td><b>{r.original_name || r.filename}</b></td>
                <td>{(r.size / 1024).toFixed(1)} KB</td>
                <td>{r.uploaded_at}</td>
                <td>
                  {r.parse_status === 'applied' ? <Chip kind="ok">已应用</Chip>
                    : r.parse_status === 'parsed' ? <Chip kind="info">已解析</Chip>
                    : <Chip kind="gray">待解析</Chip>}
                  {(r.parse_engine || r.parsed_data) && <span className="hint"> · {resumeEngineInfo(r.parse_engine || readResumeResult(r.parsed_data)?.engine).label}</span>}
                </td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Btn sm disabled={Boolean(parsing)} onClick={() => setParseTarget(r)}>{parsing === r.id ? '解析中…' : '选择解析方式'}</Btn>
                  <Btn sm onClick={() => setPreview({ rid: r.id, name: r.original_name, parsed: readResumeResult(r.parsed_data), engine: r.parse_engine, saved: true, applied: r.parse_status === 'applied', result_token: r.result_token })} disabled={!r.parsed_data}>预览 / 更新个人信息</Btn>
                  <Btn sm onClick={() => downloadResume(empId, r.id, r.original_name || r.filename).catch(() => toast('下载失败'))}>下载</Btn>
                  <Btn sm onClick={() => doDeleteResume(r.id)}>删除</Btn>
                </td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Hint>暂无简历，点击“上传简历”开始。复杂经历可直接在档案中手动补充。</Hint>}
      </Section>

      {/* 编辑弹窗 */}
      {editing && (
        <Modal onClose={() => setEditing(false)}>
          <div className="modal" style={{ width: 680, maxHeight: '86vh', overflowY: 'auto' }}>
            <h3>编辑档案 · {e.name}</h3>
            {EDIT_GROUPS.map(g => (
              <div key={g.title}>
                <div className="nav-sep" style={{ padding: '10px 0 4px' }}>{g.title}</div>
                <div className="grid g2">
                  {g.fields.map(([k, label, type, options]) => (
                    <Field key={k} label={label}>
                      {type === 'select'
                        ? <select value={form[k] || ''} onChange={ev => setForm({ ...form, [k]: ev.target.value })}>{options.map(o => <option key={o} value={o}>{o}</option>)}</select>
                        : <input type={type} value={form[k] || ''} onChange={ev => setForm({ ...form, [k]: ev.target.value })} />}
                    </Field>
                  ))}
                </div>
              </div>
            ))}
            <div className="row">
              <Btn onClick={() => setEditing(false)}>取消</Btn>
              <Btn primary onClick={saveEdit}>保存全部</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* 子表添加弹窗 */}
      {adding && (
        <Modal onClose={() => setAdding(null)}>
          <div className="modal" style={{ width: 540 }}>
            <h3>{adding === 'contact' ? '添加紧急联系人' : adding === 'edu' ? '添加教育经历' : adding === 'work' ? '添加工作经历' : '添加家庭成员'}</h3>
            <div className="grid g2">
              {adding === 'contact' && (<>
                <Field label="姓名"><input value={addForm.name} onChange={ev => setAddForm({ ...addForm, name: ev.target.value })} /></Field>
                <Field label="关系">
                  <select value={addForm.relation} onChange={ev => setAddForm({ ...addForm, relation: ev.target.value })}>
                    {RELATIONS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </Field>
                <Field label="电话"><input value={addForm.mobile} onChange={ev => setAddForm({ ...addForm, mobile: ev.target.value })} /></Field>
                <Field label="地址"><input value={addForm.address} onChange={ev => setAddForm({ ...addForm, address: ev.target.value })} /></Field>
                <Field label="主联系人">
                  <select value={addForm.is_primary} onChange={ev => setAddForm({ ...addForm, is_primary: +ev.target.value })}>
                    <option value={0}>否</option><option value={1}>是</option>
                  </select>
                </Field>
              </>)}
              {adding === 'edu' && (<>
                <Field label="学校"><input value={addForm.school} onChange={ev => setAddForm({ ...addForm, school: ev.target.value })} /></Field>
                <Field label="学历">
                  <select value={addForm.qualification} onChange={ev => setAddForm({ ...addForm, qualification: ev.target.value })}>
                    {EDUCATIONS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </Field>
                <Field label="专业"><input value={addForm.major} onChange={ev => setAddForm({ ...addForm, major: ev.target.value })} /></Field>
                <Field label="毕业年份"><input type="number" value={addForm.graduation_year} onChange={ev => setAddForm({ ...addForm, graduation_year: ev.target.value })} /></Field>
                <Field label="备注" style={{ gridColumn: '1 / -1' }}><input value={addForm.note} onChange={ev => setAddForm({ ...addForm, note: ev.target.value })} /></Field>
              </>)}
              {adding === 'work' && (<>
                <Field label="公司"><input value={addForm.company} onChange={ev => setAddForm({ ...addForm, company: ev.target.value })} /></Field>
                <Field label="职位"><input value={addForm.title} onChange={ev => setAddForm({ ...addForm, title: ev.target.value })} /></Field>
                <Field label="开始时间"><input type="month" value={addForm.start_date} onChange={ev => setAddForm({ ...addForm, start_date: ev.target.value })} /></Field>
                <Field label="结束时间"><input type="month" value={addForm.end_date} onChange={ev => setAddForm({ ...addForm, end_date: ev.target.value })} /></Field>
                <Field label="备注" style={{ gridColumn: '1 / -1' }}><input value={addForm.note} onChange={ev => setAddForm({ ...addForm, note: ev.target.value })} /></Field>
              </>)}
              {adding === 'family' && (<>
                <Field label="姓名"><input value={addForm.name} onChange={ev => setAddForm({ ...addForm, name: ev.target.value })} /></Field>
                <Field label="关系">
                  <select value={addForm.relation} onChange={ev => setAddForm({ ...addForm, relation: ev.target.value })}>
                    {FAMILY_RELATIONS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </Field>
                <Field label="备注" style={{ gridColumn: '1 / -1' }}><input value={addForm.note} onChange={ev => setAddForm({ ...addForm, note: ev.target.value })} /></Field>
              </>)}
            </div>
            <div className="row">
              <Btn onClick={() => setAdding(null)}>取消</Btn>
              <Btn primary onClick={saveAdd}>保存</Btn>
            </div>
          </div>
        </Modal>
      )}

      {parseTarget && <ResumeParsingDialog filename={parseTarget.original_name || parseTarget.filename}
        files={resumes} selectedId={parseTarget.id} onSelectFile={id => setParseTarget(resumes.find(file => file.id === id))}
        busy={Boolean(parsing)} onClose={() => setParseTarget(null)} onBasicParse={() => doParse(parseTarget.id, 'rules')} onModelParse={() => doParse(parseTarget.id, 'local_model')} />}

      {/* 简历解析结果预览 */}
      {preview && (
        <Modal onClose={() => setPreview(null)}>
          <div className="modal" style={{ width: 640, maxHeight: '86vh', overflowY: 'auto' }}>
            <h3>提取结果核对 · {preview.name}</h3>
            <ResumeResultSummary parsed={preview.parsed} engine={preview.engine} />
            <Hint>{preview.applied ? '此结果曾应用到档案，可校正后再次更新。' : '已识别，尚未更新个人信息。请核对后点击「确认写入个人信息」。'}</Hint>
            {preview.editing && <ResumeProfileEditor value={preview.edited || preview.parsed} onChange={value => setPreview({ ...preview, edited: value })} />}
            {preview.parsed ? (
              <>
                {!preview.editing && <>
                <div className="nav-sep" style={{ padding: '10px 0 4px' }}>基本信息</div>
                <div className="grid g2" style={{ fontSize: 13 }}>
                  {Object.entries(preview.parsed.basic || {}).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><span className="hint">{RESUME_FIELD_LABELS[k] || k}</span><br /><b>{Array.isArray(v) ? v.join('、') : String(v)}</b></div>
                  ))}
                  {!Object.keys(preview.parsed.basic || {}).length && <Hint>未提取到基本信息</Hint>}
                </div>
                <div className="nav-sep" style={{ padding: '10px 0 4px' }}>教育经历（{(preview.parsed.education || []).length}）</div>
                {(preview.parsed.education || []).map((x, i) => (
                  <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '5px 0', fontSize: 13 }}>
                    <b>{x.school}</b> <Chip kind="info">{x.qualification || ''}</Chip>
                    <span className="hint">{x.major ? ' · ' + x.major : ''}{x.graduation_year ? ' · ' + x.graduation_year + ' 年' : ''}</span>
                  </div>
                ))}
                <div className="nav-sep" style={{ padding: '10px 0 4px' }}>工作经历（{(preview.parsed.work_experience || []).length}）</div>
                {(preview.parsed.work_experience || []).map((x, i) => (
                  <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '5px 0', fontSize: 13 }}>
                    <b>{x.company}</b>{x.title ? ' · ' + x.title : ''}
                    <span className="hint">{x.start_date ? ' · ' + x.start_date + ' ~ ' + (x.end_date || '至今') : ''}</span>
                    {x.note && <div className="hint" style={{ whiteSpace: 'pre-wrap', marginTop: 5 }}>{x.note}</div>}
                  </div>
                ))}
                </>}
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginTop: 14 }}>
                  <input type="checkbox" checked={Boolean(preview.replaceExperience)} onChange={event => setPreview({ ...preview, replaceExperience: event.target.checked })} />
                  用本次结果替换现有教育和工作经历（用于清理旧的错误记录；未识别到的整个经历类别会保留）
                </label>
                <div className="row resume-review-actions">
                  <Btn onClick={() => setPreview(null)}>关闭</Btn>
                  {!preview.editing && <Btn onClick={() => setPreview({ ...preview, editing: true })}>校正识别内容</Btn>}
                  <Btn primary onClick={doApply}>确认写入个人信息</Btn>
                </div>
              </>
            ) : <Hint>未找到已保存的提取结果，可返回文件列表重新选择提取方式。</Hint>}
          </div>
        </Modal>
      )}
    </>
  )
}
