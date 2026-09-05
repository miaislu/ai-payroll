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
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    if (file.size > 10 * 1024 * 1024) return toast('文件超过 10MB')
    setUploading(true)
    try {
      await uploadResume(empId, file)
      toast('简历已上传：' + file.name)
      load()
    } catch { toast('上传失败（支持 txt/md/docx/pdf，≤10MB）') } finally { setUploading(false) }
  }
  const doParse = async rid => {
    const allowExternal = await askConfirm({
      title: '选择简历解析方式',
      message: '允许后将脱敏后的简历正文发送给已配置的外部 AI；选择“仅本地解析”不会发送正文。',
      confirmLabel: '允许并解析', cancelLabel: '仅本地解析'
    })
    setParsing(rid)
    try {
      const r = await parseResume(empId, rid, allowExternal)
      const name = resumes.find(x => x.id === rid)?.original_name || '简历'
      setPreview({ rid, name, parsed: r.parsed, engine: r.engine })
      toast('解析完成（' + r.engine + '）')
      load()
    } catch (e) { toast(e.message.includes('400') ? '无法解析该文件（支持 txt/md/docx/pdf）' : '解析失败') } finally { setParsing(null) }
  }
  const doApply = async () => {
    if (!preview) return
    try {
      const r = await applyResume(empId, preview.rid)
      toast(`已应用：基础 ${r.applied.basic} · 教育 ${r.applied.education} · 工作经历 ${r.applied.work_experience}`)
      setPreview(null); load()
    } catch { toast('应用失败（请先解析）') }
  }
  const doDeleteResume = async rid => {
    if (!await askConfirm({ title: '删除简历附件', message: '删除后附件及对应解析结果将被移除。', confirmLabel: '删除' })) return
    try { await deleteResume(empId, rid); toast('已删除'); load() } catch { toast('删除失败') }
  }

  if (!data) return <Card><Hint>档案加载中…</Hint></Card>
  const e = data.employee
  const dept = e.department || '—'
  const statusChip = e.status === 'departed' ? <Chip kind="warn">离职</Chip> : e.status === 'offer' ? <Chip kind="info">发offer</Chip> : <Chip kind="ok">在职</Chip>
  const age = e.date_of_birth ? Math.floor((Date.now() - new Date(e.date_of_birth)) / 31557600000) : null

  return (
    <>
      {/* 头部 */}
      <div className="toolbar">
        <Btn sm onClick={() => goto('employees')}>← 返回员工列表</Btn>
        <div style={{ flex: 1 }} />
        <span className="chip info">👤 {e.name}</span>
        <span className="chip info">{e.grade} · {e.job_family}</span>
        <span className="chip gray">{dept}</span>
        {statusChip}
      </div>

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
      <Section title={<>简历与 AI 解析 <Chip kind="info">{resumes.length} 份</Chip></>} style={{ marginTop: 14 }}>
        <div className="toolbar">
          <Hint>上传简历（txt/md/docx/pdf，≤10MB）→ 选择本地规则或脱敏后调用外部 AI → 预览确认 → 一键填充档案</Hint>
          <div style={{ flex: 1 }} />
          <input ref={fileRef} type="file" accept=".txt,.md,.text,.docx,.pdf" style={{ display: 'none' }} onChange={onPickFile} />
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
                  {r.parse_engine && <span className="hint"> · {r.parse_engine}</span>}
                </td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Btn sm disabled={parsing === r.id} onClick={() => doParse(r.id)}>{parsing === r.id ? '解析中…' : '🤖 AI 解析'}</Btn>
                  <Btn sm onClick={() => setPreview({ rid: r.id, name: r.original_name, parsed: r.parsed_data ? JSON.parse(r.parsed_data) : null, engine: r.parse_engine, saved: true })} disabled={!r.parsed_data}>预览</Btn>
                  <Btn sm onClick={() => downloadResume(empId, r.id, r.original_name || r.filename).catch(() => toast('下载失败'))}>下载</Btn>
                  <Btn sm onClick={() => doDeleteResume(r.id)}>删除</Btn>
                </td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Hint>暂无简历，点击「上传简历」开始（支持 AI 解析 txt/md/docx/pdf）</Hint>}
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

      {/* 简历解析结果预览 */}
      {preview && (
        <Modal onClose={() => setPreview(null)}>
          <div className="modal" style={{ width: 640, maxHeight: '86vh', overflowY: 'auto' }}>
            <h3>🤖 AI 解析结果 · {preview.name}</h3>
            {preview.engine && <Hint>解析引擎：{preview.engine}{preview.saved && preview.parsed?.engine ? '（' + preview.parsed.engine + '）' : ''}</Hint>}
            {preview.parsed ? (
              <>
                <div className="nav-sep" style={{ padding: '10px 0 4px' }}>基本信息</div>
                <div className="grid g2" style={{ fontSize: 13 }}>
                  {Object.entries(preview.parsed.basic || {}).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><span className="hint">{k}</span><br /><b>{Array.isArray(v) ? v.join(', ') : String(v)}</b></div>
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
                  </div>
                ))}
                <div className="row">
                  <Btn onClick={() => setPreview(null)}>关闭</Btn>
                  {!preview.saved && <Btn primary onClick={doApply}>✅ 应用到档案</Btn>}
                  {preview.saved && preview.parsed && <Hint style={{ marginRight: 'auto' }}>该简历已解析（{preview.parsed.engine}），如需重新应用请先「AI 解析」</Hint>}
                </div>
              </>
            ) : <Hint>该简历已解析过，请在列表点「预览」查看已保存的结果，或重新执行 AI 解析。</Hint>}
          </div>
        </Modal>
      )}
    </>
  )
}
