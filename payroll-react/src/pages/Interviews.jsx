import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getInterviews, createInterview, updateInterview, deleteInterview, getCandidates } from '../api.js'

const EMPTY = { candidate_id: null, round_no: 1, interviewer: '', result: 'pending', score: '', notes: '' }
const resultKind = r => ({ pass: 'ok', fail: 'warn', pending: 'gray' }[r] || 'gray')
const resultLabel = r => ({ pass: '通过', fail: '不通过', pending: '待定' }[r] || r)

export default function Interviews({ toast, backendUp }) {
  const [list, setList] = useState(null)
  const [cands, setCands] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)

  const load = async () => {
    try { setList(await getInterviews()); setCands(await getCandidates()) } catch { toast('面试数据加载失败') }
  }
  useEffect(() => { load() }, [backendUp])

  const open = m => { setForm(m === 'new' ? EMPTY : { ...m }); setEditing(m) }
  const set = k => e => setForm({ ...form, [k]: ['candidate_id', 'round_no', 'score'].includes(k) ? (e.target.value === '' ? null : +e.target.value) : e.target.value })

  const save = async () => {
    if (!form.candidate_id || !form.interviewer.trim()) return toast('候选人与面试官必填')
    try {
      if (editing === 'new') { await createInterview(form); toast('已记录面试') }
      else { await updateInterview(editing.id, form); toast('已保存') }
      setEditing(null); load()
    } catch { toast('保存失败') }
  }
  const del = async iv => {
    if (!confirm('删除该面试记录？')) return
    try { await deleteInterview(iv.id); toast('已删除'); load() } catch { toast('删除失败') }
  }

  return (
    <>
      <Card title={<>面试记录 <Chip kind="info">{list?.length || 0} 条</Chip></>}>
        <div className="toolbar">
          <Hint>按候选人记录多轮面试：面试官 / 日期 / 结果 / 评分 / 评价</Hint>
          <div style={{ flex: 1 }} />
          <Btn primary onClick={() => open('new')}>+ 记录面试</Btn>
        </div>
        <table>
          <tr><th>候选人</th><th>轮次</th><th>面试官</th><th>日期</th><th>结果</th><th>评分</th><th>评价</th><th>操作</th></tr>
          {list?.map(iv => (
            <tr key={iv.id}>
              <td><b>{iv.candidate_name || '（已删除候选人）'}</b></td>
              <td>R{iv.round_no}</td>
              <td>{iv.interviewer}</td>
              <td>{iv.interview_date}</td>
              <td><Chip kind={resultKind(iv.result)}>{resultLabel(iv.result)}</Chip></td>
              <td>{iv.score ?? '—'}</td>
              <td className="hint">{iv.notes || '—'}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <Btn sm onClick={() => open(iv)}>编辑</Btn>
                <Btn sm onClick={() => del(iv)}>删除</Btn>
              </td>
            </tr>
          ))}
          {list && !list.length && <tr><td colSpan={8}><Hint>暂无面试记录</Hint></td></tr>}
        </table>
      </Card>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div className="modal" style={{ width: 520 }}>
            <h3>{editing === 'new' ? '记录面试' : '编辑面试'}</h3>
            <div className="grid g2">
              <Field label="候选人">
                <select value={form.candidate_id || ''} onChange={set('candidate_id')}>
                  <option value="">— 选择候选人 —</option>
                  {cands.map(c => <option key={c.id} value={c.id}>{c.name}（{c.requisition_title || '未关联'}）</option>)}
                </select>
              </Field>
              <Field label="轮次"><input type="number" value={form.round_no} onChange={set('round_no')} min={1} /></Field>
              <Field label="面试官"><input value={form.interviewer} onChange={set('interviewer')} placeholder="必填" /></Field>
              <Field label="日期"><input type="date" value={form.interview_date || ''} onChange={set('interview_date')} /></Field>
              <Field label="结果">
                <select value={form.result} onChange={set('result')}>
                  <option value="pending">待定</option><option value="pass">通过</option><option value="fail">不通过</option>
                </select>
              </Field>
              <Field label="评分（0-100）"><input type="number" value={form.score ?? ''} onChange={set('score')} /></Field>
              <Field label="评价" style={{ gridColumn: '1 / -1' }}><input value={form.notes} onChange={set('notes')} /></Field>
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
