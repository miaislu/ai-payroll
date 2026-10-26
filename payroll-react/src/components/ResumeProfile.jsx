import { Btn, Field, Hint } from './ui.jsx'
import { RESUME_FIELD_LABELS } from './ResumeParsing.jsx'

const BASIC = Object.keys(RESUME_FIELD_LABELS).filter(key => key !== 'phone')
const TYPES = { date_of_birth: 'date', personal_email: 'email' }
const EDUCATION = { school: '学校', qualification: '学历', major: '专业', graduation_year: '毕业年份', note: '教育经历说明' }
const WORK = { company: '公司', title: '职位', start_date: '开始年月', end_date: '结束年月', note: '职责、项目与成果' }

export function ResumeProfileEditor({ value, onChange }) {
  const basic = value?.basic || {}
  const setBasic = (key, text) => onChange({ ...value, basic: { ...basic, [key]: text } })
  return <div>
    <h4>个人信息</h4>
    <div className="grid g2">
      {BASIC.map(key => <Field key={key} label={RESUME_FIELD_LABELS[key]} style={key === 'skills' || key === 'current_address' ? { gridColumn: '1 / -1' } : {}}>
        {key === 'skills' ? <textarea rows={3} value={basic[key] || ''} onChange={event => setBasic(key, event.target.value)} />
          : <input type={TYPES[key] || 'text'} value={basic[key] || ''} onChange={event => setBasic(key, event.target.value)} />}
      </Field>)}
    </div>
    {[['education', '教育经历', EDUCATION], ['work_experience', '工作经历', WORK]].map(([key, title, fields]) => <div key={key} style={{ marginTop: 16 }}>
      <h4>{title}（{value?.[key]?.length || 0}）</h4>
      {(value?.[key] || []).map((row, index) => <div key={index} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
        <div className="grid g2">{Object.entries(fields).map(([field, label]) => <Field key={field} label={`${label} ${index + 1}`} style={field === 'note' ? { gridColumn: '1 / -1' } : {}}>
          {field === 'note' ? <textarea rows={4} value={row[field] || ''} onChange={event => onChange({ ...value, [key]: value[key].map((item, i) => i === index ? { ...item, [field]: event.target.value } : item) })} />
            : <input type={field.endsWith('_date') ? 'month' : field === 'graduation_year' ? 'number' : 'text'} value={row[field] ?? ''} onChange={event => onChange({ ...value, [key]: value[key].map((item, i) => i === index ? { ...item, [field]: event.target.value } : item) })} />}
        </Field>)}</div>
        <Btn sm onClick={() => onChange({ ...value, [key]: value[key].filter((_, i) => i !== index) })}>移除此段</Btn>
      </div>)}
      <Btn sm onClick={() => onChange({ ...value, [key]: [...(value?.[key] || []), {}] })}>+ 添加{title}</Btn>
      {key === 'work_experience' && <Hint>仍在职可将结束年月留空。</Hint>}
    </div>)}
  </div>
}

export function ResumeProfileDetails({ value }) {
  return <div style={{ marginTop: 14 }}>
    <h4>个人信息</h4>
    <div className="grid g2" style={{ fontSize: 13 }}>{BASIC.filter(key => value?.basic?.[key]).map(key => <div key={key} style={key === 'skills' || key === 'current_address' ? { gridColumn: '1 / -1' } : {}}>
      <span className="hint">{RESUME_FIELD_LABELS[key]}</span><br /><span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value.basic[key]}</span>
    </div>)}</div>
    {[['education', '教育经历'], ['work_experience', '工作经历']].map(([key, title]) => <div key={key} style={{ marginTop: 12 }}>
      <h4>{title}（{value?.[key]?.length || 0}）</h4>
      {(value?.[key] || []).map((row, index) => <div key={index} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, marginBottom: 6, fontSize: 13 }}>
        <b>{row.school || row.company}</b>{row.qualification || row.title ? ` · ${row.qualification || row.title}` : ''}
        <div className="hint">{key === 'education' ? [row.major, row.graduation_year ? `${row.graduation_year} 年毕业` : ''].filter(Boolean).join(' · ') : row.start_date ? `${row.start_date} ~ ${row.end_date || '至今'}` : ''}</div>
        {row.note && <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{row.note}</div>}
      </div>)}
      {!value?.[key]?.length && <Hint>暂无已保存的{title}</Hint>}
    </div>)}
  </div>
}
