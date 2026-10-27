import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getInterviews, createInterview, updateInterview, deleteInterview, getCandidates } from '../api.js'
import { useDialog } from '../components/DialogProvider.jsx'
import { INTERVIEW_RATINGS, interviewRating, INTERVIEW_STATUS_LABELS } from '../data.js'
import { currentDate } from '../lib/period.js'
import { interviewOutcomeLabel } from '../lib/interview-outcome.js'

const EMPTY = { candidate_id: null, round_no: 1, interviewer: '', status: 'completed', result: 'pending', notes: '' }

export default function Interviews({ toast, backendUp, goto, candidateId }) {
  const { confirm: askConfirm } = useDialog()
  const [list, setList] = useState(null)
  const [cands, setCands] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)

  const load = async () => {
    try { setList(await getInterviews()); setCands(await getCandidates()) } catch { toast('面试数据加载失败') }
  }
  useEffect(() => { load() }, [backendUp])

  const open = (m, status) => {
    const candidate = cands.find(item => item.id === candidateId)
    const round = Math.max(0, ...(candidate?.interviews || []).map(item => item.round_no)) + 1
    setForm(m === 'new' ? { ...EMPTY, status: status || 'completed', candidate_id: candidateId || null, round_no: round, interview_date: currentDate() } : { ...m, status: status || m.status || 'completed', result: interviewRating(m.result).key })
    setEditing(m)
  }
  const set = k => e => setForm({ ...form, [k]: ['candidate_id', 'round_no'].includes(k) ? (e.target.value === '' ? null : +e.target.value) : e.target.value })

  const save = async () => {
    if (!form.candidate_id || !form.interviewer.trim()) return toast('候选人与面试官必填')
    try {
      if (editing === 'new') { await createInterview(form); toast('已记录面试') }
      else { await updateInterview(editing.id, form); toast('已保存') }
      setEditing(null); load()
    } catch (error) { toast('保存失败：' + error.message) }
  }
  const del = async iv => {
    if (!await askConfirm({ title: '删除面试记录', message: '删除后该记录将不再作为招聘和 Offer 审批依据。', confirmLabel: '删除' })) return
    try { await deleteInterview(iv.id); toast('已删除'); load() } catch { toast('删除失败') }
  }
  const visibleList = candidateId ? list?.filter(item => item.candidate_id === candidateId) : list

  return (
    <>
      <Card title={<>面试记录 <Chip kind="info">{visibleList?.length || 0} 条</Chip></>}>
        <div className="toolbar">
          <label className="f">候选人筛选
            <select value={candidateId || ''} onChange={e => goto('interviews', e.target.value ? Number(e.target.value) : null)}>
              <option value="">全部候选人</option>
              {cands.map(item => <option key={item.id} value={item.id}>{item.name}（{item.requisition_title || '未关联需求'}）</option>)}
            </select>
          </label>
          <Hint>与简历库共用面试安排和面评；开始 / 完成面试后自动记录轮次流转。</Hint>
          <div style={{ flex: 1 }} />
          <Btn onClick={() => open('new', 'scheduled')}>+ 安排面试</Btn>
          <Btn primary onClick={() => open('new')}>+ 记录面评</Btn>
        </div>
        <table>
          <thead><tr><th>候选人</th><th>轮次</th><th>面试官</th><th>日期</th><th>状态</th><th>评分</th><th>面评 / 备注</th><th>操作</th></tr></thead>
          <tbody>
          {visibleList?.map(iv => (
            <tr key={iv.id}>
              <td><button className="btn sm" onClick={() => goto('candidates', iv.candidate_id)}>{iv.candidate_name || '（已删除候选人）'}</button><div className="hint">{iv.requisition_title || '未关联需求'}</div></td>
              <td>R{iv.round_no}</td>
              <td>{iv.interviewer}</td>
              <td>{iv.interview_date}</td>
              <td><Chip kind={iv.status === 'completed' ? interviewRating(iv.result).kind : 'info'}>{interviewOutcomeLabel(iv)}</Chip></td>
              <td>{iv.status === 'completed' ? <Chip kind={interviewRating(iv.result).kind}>{interviewRating(iv.result).label}</Chip> : '—'}</td>
              <td className="hint">{iv.notes || '—'}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                {iv.status === 'scheduled' && <Btn sm onClick={async () => {
                  try { await updateInterview(iv.id, { status: 'in_progress' }); await load() } catch (error) { toast(error.message) }
                }}>开始面试</Btn>}
                {['scheduled', 'in_progress'].includes(iv.status) && <Btn sm primary onClick={() => open(iv, 'completed')}>填写面评</Btn>}
                <Btn sm onClick={() => open(iv)}>编辑</Btn>
                <Btn sm onClick={() => del(iv)}>删除</Btn>
              </td>
            </tr>
          ))}
          {visibleList && !visibleList.length && <tr><td colSpan={8}><Hint>暂无面试记录；添加时选择简历库中的候选人即可关联。</Hint></td></tr>}
          </tbody>
        </table>
      </Card>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div className="modal" style={{ width: 680 }}>
            <h3>{editing === 'new' ? form.status === 'scheduled' ? '安排面试' : '记录面评' : '编辑面试'}</h3>
            <div className="grid g2">
              <Field label="候选人">
                <select value={form.candidate_id || ''} disabled={editing !== 'new'} onChange={e => {
                  const id = Number(e.target.value) || null
                  const candidate = cands.find(item => item.id === id)
                  setForm({ ...form, candidate_id: id, round_no: Math.max(0, ...(candidate?.interviews || []).map(item => item.round_no)) + 1 })
                }}>
                  <option value="">— 选择候选人 —</option>
                  {cands.map(c => <option key={c.id} value={c.id}>{c.name}（{c.requisition_title || '未关联'}）</option>)}
                </select>
              </Field>
              <Field label="轮次"><input type="number" value={form.round_no} onChange={set('round_no')} min={1} /></Field>
              <Field label="面试官"><input value={form.interviewer} onChange={set('interviewer')} placeholder="必填" /></Field>
              <Field label="日期"><input type="date" value={form.interview_date || ''} onChange={set('interview_date')} /></Field>
              <Field label="面试状态"><select value={form.status} onChange={set('status')}>
                {Object.entries(INTERVIEW_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select></Field>
              {form.status === 'completed' && <Field label="评分">
                <select value={form.result} onChange={set('result')}>
                  {INTERVIEW_RATINGS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </Field>}
              <Field label="面评" style={{ gridColumn: '1 / -1' }}><textarea rows={7} value={form.notes || ''} onChange={set('notes')} placeholder="记录候选人的能力表现、优势、风险点和录用建议" /></Field>
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
