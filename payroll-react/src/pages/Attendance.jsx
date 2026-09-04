import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field } from '../components/ui.jsx'
import { getAttendance, saveAttendance } from '../api.js'
import { formatYuan } from '../lib/format.js'
import { currentPeriod, periodOptions } from '../lib/period.js'

export default function Attendance({ toast, backendUp, user }) {
  const isAdmin = user?.role === 'hr' || user?.role === 'founder'
  const [period, setPeriod] = useState(currentPeriod())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!backendUp) return
    setLoading(true)
    try {
      const d = await getAttendance(period)
      setRows((d.rows || []).map(r => ({ ...r })))
    } catch { toast('考勤加载失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [period, backendUp])

  const set = (i, key, value) => setRows(list => list.map((r, idx) => idx === i ? { ...r, [key]: value } : r))
  const save = async () => {
    try {
      await saveAttendance({
        period,
        rows: rows.map(r => ({
          employee_id: r.employee_id,
          work_days: Number(r.work_days) || 0,
          scheduled_work_days: Number(r.scheduled_work_days) || 0,
          ot_weekday_hours: Number(r.ot_weekday_hours) || 0,
          ot_rest_hours: Number(r.ot_rest_hours) || 0,
          ot_holiday_hours: Number(r.ot_holiday_hours) || 0,
          unpaid_leave_days: Number(r.unpaid_leave_days) || 0,
          note: r.note || ''
        }))
      })
      toast('考勤已保存，未提交月份的算薪会按此加班重算')
      load()
    } catch (e) { toast(e.message || '保存失败') }
  }

  return (
    <>
      <div className="toolbar">
        <Field label="月份">
          <select value={period} onChange={e => setPeriod(e.target.value)}>
            {periodOptions().map(p => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Hint>加班基数 = 月薪 ÷ 21.75 ÷ 8；工作日 ×1.5 / 休息日 ×2 / 法定假 ×3。覆盖员工表上的固定加班费。</Hint>
        <div style={{ flex: 1 }} />
        {isAdmin && <Btn primary onClick={save} disabled={loading || !rows.length}>保存本月考勤</Btn>}
      </div>
      <Card title={<>{period} 考勤 <Chip kind="info">{rows.length} 人</Chip></>}>
        {!backendUp && <Hint>需要后端才能读写考勤。</Hint>}
        <table>
          <thead>
            <tr>
              <th>员工</th><th>计薪天</th><th>计划工作日</th><th>工作日加班 h</th><th>休息日加班 h</th><th>法定假加班 h</th><th>无薪假天</th>
              <th>加班费</th>{isAdmin && <th>备注</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.employee_id}>
                <td><b>{r.name}</b><div className="hint">{r.grade} · {r.job_family}</div></td>
                <td>{isAdmin ? <input type="number" min={0} max={31} value={r.work_days} onChange={e => set(i, 'work_days', e.target.value)} style={{ width: 64 }} /> : r.work_days}</td>
                <td>{isAdmin ? <input type="number" min={0.1} max={31} value={r.scheduled_work_days} onChange={e => set(i, 'scheduled_work_days', e.target.value)} style={{ width: 64 }} /> : r.scheduled_work_days}</td>
                <td>{isAdmin ? <input type="number" min={0} value={r.ot_weekday_hours} onChange={e => set(i, 'ot_weekday_hours', e.target.value)} style={{ width: 64 }} /> : r.ot_weekday_hours}</td>
                <td>{isAdmin ? <input type="number" min={0} value={r.ot_rest_hours} onChange={e => set(i, 'ot_rest_hours', e.target.value)} style={{ width: 64 }} /> : r.ot_rest_hours}</td>
                <td>{isAdmin ? <input type="number" min={0} value={r.ot_holiday_hours} onChange={e => set(i, 'ot_holiday_hours', e.target.value)} style={{ width: 64 }} /> : r.ot_holiday_hours}</td>
                <td>{isAdmin ? <input type="number" min={0} max={22} value={r.unpaid_leave_days} onChange={e => set(i, 'unpaid_leave_days', e.target.value)} style={{ width: 64 }} /> : r.unpaid_leave_days}</td>
                <td>{formatYuan(r.ot_amount)}</td>
                {isAdmin && <td><input value={r.note || ''} onChange={e => set(i, 'note', e.target.value)} style={{ width: 140 }} /></td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9}><Hint>{loading ? '加载中…' : '本月暂无记录'}</Hint></td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  )
}
