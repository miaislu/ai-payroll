import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getPerformance, savePerformance, deletePerformance, raiseFromPerformance, getEmployees } from '../api.js'
import { currentCycle, cycleOptions } from '../lib/period.js'

const RATINGS = ['S', 'A', 'B', 'C', 'D']
const EMPTY = { employee_id: '', cycle: currentCycle(), rating: 'A', score: '', comment: '' }

export default function Performance({ toast, backendUp, user, goto }) {
  const isAdmin = user?.role === 'hr' || user?.role === 'founder'
  const [cycle, setCycle] = useState(currentCycle())
  const [rows, setRows] = useState([])
  const [emps, setEmps] = useState([])
  const [form, setForm] = useState(null)

  const load = async () => {
    if (!backendUp) return
    try {
      const d = await getPerformance(cycle)
      setRows(d.rows || [])
      if (isAdmin) setEmps(await getEmployees())
    } catch { toast('绩效加载失败') }
  }
  useEffect(() => { load() }, [cycle, backendUp])

  const save = async () => {
    if (!form.employee_id) return toast('请选择员工')
    try {
      await savePerformance({ ...form, employee_id: Number(form.employee_id), score: form.score === '' ? null : Number(form.score) })
      toast('绩效已保存')
      setForm(null)
      load()
    } catch (e) { toast(e.message || '保存失败') }
  }
  const raise = async row => {
    try {
      const r = await raiseFromPerformance(row.id)
      toast(`已发起调薪审批 ${r.id}`)
      goto?.('raise-approval')
    } catch (e) { toast(e.message || '发起失败') }
  }
  const remove = async row => {
    if (!confirm(`删除 ${row.name} ${row.cycle} 绩效？`)) return
    try { await deletePerformance(row.id); toast('已删除'); load() } catch (e) { toast(e.message || '删除失败') }
  }

  return (
    <>
      <div className="toolbar">
        <Field label="周期">
          <select value={cycle} onChange={e => setCycle(e.target.value)}>
            {cycleOptions().map(value => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Hint>S +12% / A +8% / B +3% / C、D 不调薪。发起后进入审批中心，财务或 CEO 同意后改月薪。</Hint>
        <div style={{ flex: 1 }} />
        {isAdmin && <Btn primary onClick={() => setForm({ ...EMPTY, cycle })}>+ 录入评级</Btn>}
      </div>
      <Card title={<>{cycle} 绩效 <Chip kind="info">{rows.length} 人</Chip></>}>
        {!backendUp && <Hint>需要后端才能读写绩效。</Hint>}
        <table>
          <thead><tr><th>员工</th><th>评级</th><th>分数</th><th>建议调薪</th><th>说明</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><b>{r.name}</b><div className="hint">{r.grade} · {r.job_family}{r.flag ? ` · ${r.flag}` : ''}</div></td>
                <td><Chip kind={r.rating === 'S' ? 'ok' : r.rating === 'D' ? 'bad' : 'info'}>{r.rating}</Chip></td>
                <td>{r.score ?? '—'}</td>
                <td>{r.suggest?.pct ? `+${Math.round(r.suggest.pct * 100)}% → ¥${r.suggest.to_monthly?.toLocaleString('zh-CN')}/月` : '不调薪'}</td>
                <td className="hint">{r.comment || '—'}</td>
                {isAdmin && (
                  <td style={{ display: 'flex', gap: 6 }}>
                    {r.suggest?.pct > 0 && <Btn sm onClick={() => raise(r)}>发起调薪</Btn>}
                    <Btn sm onClick={() => remove(r)}>删除</Btn>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6}><Hint>本周期暂无评级</Hint></td></tr>}
          </tbody>
        </table>
      </Card>
      {form && (
        <Modal onClose={() => setForm(null)}>
          <div className="modal">
            <h3>录入绩效</h3>
            <div className="grid g2" style={{ marginTop: 10 }}>
              <Field label="员工">
                <select value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })}>
                  <option value="">选择</option>
                  {emps.filter(e => e.status === 'active').map(e => <option key={e.id} value={e.id}>{e.name} · {e.grade}</option>)}
                </select>
              </Field>
              <Field label="评级">
                <select value={form.rating} onChange={e => setForm({ ...form, rating: e.target.value })}>
                  {RATINGS.map(x => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="分数"><input type="number" min={0} max={100} value={form.score} onChange={e => setForm({ ...form, score: e.target.value })} /></Field>
              <Field label="周期"><input value={form.cycle} onChange={e => setForm({ ...form, cycle: e.target.value })} /></Field>
            </div>
            <Field label="评语"><input value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} /></Field>
            <div className="row" style={{ marginTop: 12 }}>
              <Btn onClick={() => setForm(null)}>取消</Btn>
              <Btn primary onClick={save}>保存</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
