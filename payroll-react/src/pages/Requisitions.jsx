import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getRequisitions, createRequisition, updateRequisition, deleteRequisition, downloadAuthenticated } from '../api.js'
import { REQUISITION_STATUS } from '../data.js'
import { JOB_CATALOG, categoryForJob } from '../jobCatalog.js'
import { addMonths, currentPeriod } from '../lib/period.js'
import { useDialog } from '../components/DialogProvider.jsx'

const EMPTY = {
  title: '', department_id: null, grade: 'P5', job_category: 'tech', job_family: JOB_CATALOG.tech.jobs[0],
  city: '上海', team_label: '', headcount: 1, headcount_max: 1, employment_type: 'employee', priority: 'P1', status: 'open',
  salary_min: 30000, salary_max: 50000, fixed_salary_months: 12, annual_bonus_months: 1,
  responsibilities: '', requirements: '', education_requirement: '本科', experience_requirement: '3-5年',
  skills: '', reason: '', target_month: addMonths(currentPeriod(), 2), target_timing: ''
}
const statusKind = k => ({ open: 'ok', interview: 'info', draft: 'gray', closed: 'gray', cancelled: 'warn' }[k] || 'gray')
const statusLabel = k => REQUISITION_STATUS.find(s => s.key === k)?.label || k
const priorityLabel = k => ({ P0: 'P0 最高', P1: 'P1 重要', P2: 'P2 常规', pending: '待定', urgent: 'P0 最高', high: 'P1 重要', normal: 'P2 常规', low: '低' }[k] || k)
const priorityKind = k => ({ P0: 'bad', urgent: 'bad', P1: 'warn', high: 'warn', P2: 'info', normal: 'info' }[k] || 'gray')

export default function Requisitions({ toast, backendUp }) {
  const { confirm: askConfirm } = useDialog()
  const [list, setList] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)

  const load = async () => {
    try { setList(await getRequisitions()) } catch { toast('招聘需求加载失败') }
  }
  useEffect(() => { load() }, [backendUp])

  const open = m => { setForm(m === 'new' ? { ...EMPTY } : { ...m, job_category: m.job_category || categoryForJob(m.job_family) }); setEditing(m) }
  const set = k => e => setForm({ ...form, [k]: ['headcount', 'headcount_max', 'salary_min', 'salary_max', 'fixed_salary_months', 'annual_bonus_months'].includes(k) ? (e.target.value === '' ? null : +e.target.value) : e.target.value })
  const setCategory = e => {
    const job_category = e.target.value
    setForm({ ...form, job_category, job_family: JOB_CATALOG[job_category].jobs[0] })
  }

  const save = async () => {
    if (!form.title.trim()) return toast('岗位名称必填')
    try {
      if (editing === 'new') { await createRequisition(form); toast('已创建招聘需求') }
      else { await updateRequisition(editing.id, form); toast('已保存') }
      setEditing(null); load()
    } catch { toast('保存失败') }
  }
  const del = async r => {
    if (!await askConfirm({ title: '删除招聘需求', message: `确认删除“${r.title}”？关联候选人会保留，但不再关联该需求。`, confirmLabel: '删除' })) return
    try { await deleteRequisition(r.id); toast('已删除'); load() } catch { toast('删除失败') }
  }
  const exportOne = r => downloadAuthenticated(`/recruiting/requisitions/export?id=${r.id}`, `${r.title}-招聘JD.txt`).catch(() => toast('导出失败'))
  const exportAll = () => downloadAuthenticated('/recruiting/requisitions/export', '全部在招岗位JD.txt').catch(() => toast('暂无可导出的在招需求'))

  return (
    <>
      <Card title={<>招聘需求 <Chip kind="info">{list?.length || 0} 个</Chip></>}>
        <div className="toolbar">
          <Hint>维护完整招聘 JD，可单独或批量导出后直接转发猎头、复制到招聘网站</Hint>
          <div style={{ flex: 1 }} />
          <Btn onClick={exportAll}>导出全部 JD</Btn>
          <Btn primary onClick={() => open('new')}>+ 新建需求</Btn>
        </div>
        <table>
          <thead><tr><th>岗位</th><th>团队 / 分类</th><th>优先级</th><th>基准 / 上限</th><th>建议到岗</th><th>候选进度</th><th>薪酬包</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
          {list?.map(r => (
            <tr key={r.id}>
              <td><b>{r.title}</b><div className="hint">{r.city}</div></td>
              <td>{r.team_label || '—'}<div><Chip kind={r.job_category === 'tech' ? 'info' : r.job_category === 'mgmt' ? 'warn' : 'gray'}>{JOB_CATALOG[r.job_category]?.label || '技术'}</Chip></div></td>
              <td><Chip kind={priorityKind(r.priority)}>{priorityLabel(r.priority)}</Chip></td>
              <td>{Number(r.headcount) > 0 ? `${r.headcount} / ${r.headcount_max ?? r.headcount} 人` : '待定'}</td>
              <td>{r.target_timing || r.target_month || '待定'}</td>
              <td>{r.filled} 入职 / {r.active_candidates} 进行中</td>
              <td>{r.salary_min ? '¥' + r.salary_min.toLocaleString('zh-CN') + ' ~ ' + r.salary_max.toLocaleString('zh-CN') + '/月' : '面议'}<div className="hint">{Number(r.fixed_salary_months ?? 12)} 薪 + {Number(r.annual_bonus_months ?? 0)} 月年终奖</div></td>
              <td><Chip kind={statusKind(r.status)}>{statusLabel(r.status)}</Chip></td>
              <td style={{ display: 'flex', gap: 6 }}>
                <Btn sm onClick={() => exportOne(r)}>导出 JD</Btn>
                <Btn sm onClick={() => open(r)}>编辑</Btn>
                <Btn sm onClick={() => del(r)}>删除</Btn>
              </td>
            </tr>
          ))}
          {list && !list.length && <tr><td colSpan={9}><Hint>暂无招聘需求</Hint></td></tr>}
          </tbody>
        </table>
      </Card>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div className="modal" style={{ width: 760, maxHeight: '88vh', overflowY: 'auto' }}>
            <h3>{editing === 'new' ? '新建招聘需求' : '编辑需求 · ' + editing.title}</h3>
            <div className="grid g2">
              <Field label="岗位名称"><input value={form.title} onChange={set('title')} placeholder="如：数字前端(RTL)工程师" /></Field>
              <Field label="岗位大类"><select value={form.job_category} onChange={setCategory}>{Object.entries(JOB_CATALOG).map(([key, group]) => <option key={key} value={key}>{group.label}</option>)}</select></Field>
              <Field label="具体岗位"><select value={form.job_family} onChange={set('job_family')}>{JOB_CATALOG[form.job_category]?.jobs.map(job => <option key={job}>{job}</option>)}</select></Field>
              <Field label="团队 / 方向"><input value={form.team_label || ''} onChange={set('team_label')} placeholder="如：研发-工艺与设备" /></Field>
              <Field label="城市"><input value={form.city} onChange={set('city')} /></Field>
              <Field label="基准编制"><input type="number" value={form.headcount} onChange={set('headcount')} min={0} /></Field>
              <Field label="弹性上限"><input type="number" value={form.headcount_max ?? form.headcount} onChange={set('headcount_max')} min={form.headcount || 0} /></Field>
              <Field label="用工类型"><select value={form.employment_type} onChange={set('employment_type')}><option value="employee">正式员工</option><option value="consultant">顾问</option><option value="intern">实习生</option></select></Field>
              <Field label="建议到岗时间（原始口径）"><input value={form.target_timing || ''} onChange={set('target_timing')} placeholder="如：Q4-2026~Q1-2027" /></Field>
              <Field label="预计到岗月（联动成本预测）"><input type="month" value={form.target_month || ''} onChange={set('target_month')} /></Field>
              <Field label="月薪下限"><input type="number" value={form.salary_min} onChange={set('salary_min')} /></Field>
              <Field label="月薪上限"><input type="number" value={form.salary_max} onChange={set('salary_max')} /></Field>
              <Field label="全年固定薪资月数"><select value={form.fixed_salary_months} onChange={set('fixed_salary_months')}>{[12, 13, 14, 15, 16, 17, 18].map(n => <option key={n} value={n}>{n} 个月</option>)}</select></Field>
              <Field label="年终奖约定月数"><select value={form.annual_bonus_months} onChange={set('annual_bonus_months')}>{[0, 0.5, 1, 1.5, 2, 3, 4, 6].map(n => <option key={n} value={n}>{n} 个月</option>)}</select></Field>
              <Field label="学历要求"><select value={form.education_requirement || ''} onChange={set('education_requirement')}>{['不限', '大专', '本科', '硕士', '博士'].map(v => <option key={v}>{v}</option>)}</select></Field>
              <Field label="经验要求"><select value={form.experience_requirement || ''} onChange={set('experience_requirement')}>{['不限', '应届', '1-3年', '3-5年', '5-10年', '10年以上'].map(v => <option key={v}>{v}</option>)}</select></Field>
              <Field label="优先级">
                <select value={form.priority} onChange={set('priority')}>
                  <option value="P0">P0 最高</option><option value="P1">P1 重要</option><option value="P2">P2 常规</option><option value="pending">待定</option>
                </select>
              </Field>
              <Field label="状态">
                <select value={form.status} onChange={set('status')}>
                  {REQUISITION_STATUS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="关键技能" style={{ gridColumn: '1 / -1' }}><input value={form.skills || ''} onChange={set('skills')} placeholder="如：Verilog、UVM、STA（逗号分隔）" /></Field>
              <Field label="岗位职责" style={{ gridColumn: '1 / -1' }}><textarea rows={4} value={form.responsibilities || ''} onChange={set('responsibilities')} placeholder="建议逐条填写，每行一项" /></Field>
              <Field label="任职要求" style={{ gridColumn: '1 / -1' }}><textarea rows={4} value={form.requirements || ''} onChange={set('requirements')} placeholder="专业背景、经验、能力与加分项" /></Field>
              <Field label="招聘背景" style={{ gridColumn: '1 / -1' }}><textarea rows={2} value={form.reason || ''} onChange={set('reason')} placeholder="新增编制 / 替补 / 项目背景" /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setEditing(null)}>取消</Btn>
              <Btn primary onClick={save}>保存</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
