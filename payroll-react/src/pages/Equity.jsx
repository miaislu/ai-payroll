import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Kpi, Modal } from '../components/ui.jsx'
import { getEquityPool, updateEquityPool, getEquityGrants, createEquityGrant, updateEquityGrant, deleteEquityGrant, getEquitySummary, getEmployees } from '../api.js'
import { formatWan } from '../lib/format.js'

const STATUS_LABEL = { granted: '归属中', vested: '已归属', exercised: '已行权', forfeited: '已失效' }
const STATUS_KIND = { granted: 'info', vested: 'ok', exercised: 'ok', forfeited: 'warn' }
const EMPTY = { employee_id: null, grant_date: new Date().toISOString().slice(0, 10), share_count: '', exercise_price: 1, fair_value: 50, vesting_months: 48, cliff_months: 12, status: 'granted', note: '' }

export default function Equity({ toast, backendUp }) {
  const [pool, setPool] = useState(null)
  const [grants, setGrants] = useState(null)
  const [summary, setSummary] = useState(null)
  const [emps, setEmps] = useState([])
  const [editing, setEditing] = useState(null) // null | 'new' | grant
  const [form, setForm] = useState(EMPTY)
  const [editingPool, setEditingPool] = useState(false)
  const [poolForm, setPoolForm] = useState({})

  const load = async () => {
    try {
      const [p, g, s, e] = await Promise.all([getEquityPool(), getEquityGrants(), getEquitySummary(), getEmployees()])
      setPool(p); setGrants(g); setSummary(s)
      setEmps(e.filter(x => x.status !== 'departed'))
    } catch { toast('期权数据加载失败') }
  }
  useEffect(() => { load() }, [backendUp])

  const open = m => { setForm(m === 'new' ? EMPTY : { ...m }); setEditing(m) }
  const set = k => ev => setForm({ ...form, [k]: ['employee_id', 'share_count', 'exercise_price', 'fair_value', 'vesting_months', 'cliff_months'].includes(k) ? (ev.target.value === '' ? null : +ev.target.value) : ev.target.value })

  const save = async () => {
    if (!form.employee_id || !form.share_count) return toast('员工与授予股数必填')
    try {
      if (editing === 'new') { const r = await createEquityGrant(form); toast(`已授予（月摊销 ¥${r.monthly_amort.toLocaleString('zh-CN')}）`) }
      else { await updateEquityGrant(editing.id, form); toast('已保存') }
      setEditing(null); load()
    } catch { toast('保存失败') }
  }
  const del = async g => {
    if (!confirm(`删除 ${g.employee_name} 的授予记录？`)) return
    try { await deleteEquityGrant(g.id); toast('已删除'); load() } catch { toast('删除失败') }
  }
  const savePool = async () => {
    try { await updateEquityPool(poolForm); toast('期权池已更新'); setEditingPool(false); load() }
    catch { toast('保存失败') }
  }

  return (
    <>
      <div className="grid g4">
        <Kpi label="期权池" num={pool ? pool.pool_percent + '%' : '—'} sub={pool ? `共 ${pool.total_shares} 万股` : ''} numColor="#8b5cf6" />
        <Kpi label="已授予 / 剩余" num={pool ? `${pool.granted_shares} / ${pool.remaining_shares} 万股` : '—'} sub={`${pool?.active_employees || 0} 名员工持授予`} numColor="#2f54eb" />
        <Kpi label="月摊销（联动成本）" num={pool ? '¥' + pool.monthly_amort.toLocaleString('zh-CN') : '—'} sub={`年摊销 ${pool ? formatWan(pool.annual_amort) : '—'}`} numColor="#dc2626" />
        <Kpi label="每股公允价" num={pool ? '¥' + pool.share_price : '—'} sub={pool ? `估值 ${formatWan(pool.valuation_wan)}` : ''} numColor="#10b981" />
      </div>

      <Card title={<>期权授予台账 <Chip kind="info">{grants?.length || 0} 条</Chip></>} style={{ marginTop: 14 }}>
        <div className="toolbar">
          <Hint>授予价值 = 股数 × (公允价 − 行权价)；月摊销 = 价值 ÷ 归属期（默认 4 年/1 年 cliff），自动计入「薪酬成本-期权摊销」</Hint>
          <div style={{ flex: 1 }} />
          <Btn sm onClick={() => { setPoolForm({ pool_percent: pool?.pool_percent, total_shares: pool?.total_shares, valuation_wan: pool?.valuation_wan }); setEditingPool(true) }}>⚙️ 期权池设置</Btn>
          <Btn primary onClick={() => open('new')}>+ 新增授予</Btn>
        </div>
        <table>
          <tr><th>员工</th><th>职级</th><th>授予日</th><th>股数(万)</th><th>行权价</th><th>公允价</th><th>归属期</th><th>授予价值</th><th>月摊销</th><th>状态</th><th>备注</th><th>操作</th></tr>
          {grants?.map(g => (
            <tr key={g.id}>
              <td><b>{g.employee_name}</b></td>
              <td>{g.grade} {g.job_family}</td>
              <td>{g.grant_date}</td>
              <td>{g.share_count}</td>
              <td>¥{g.exercise_price}</td>
              <td>¥{g.fair_value}</td>
              <td>{g.vesting_months} 月{g.cliff_months > 0 ? `（cliff ${g.cliff_months}）` : ''}</td>
              <td style={{ fontWeight: 600 }}>{formatWan(g.total_value)}</td>
              <td style={{ color: '#dc2626' }}>¥{g.monthly_amort.toLocaleString('zh-CN')}/月</td>
              <td><Chip kind={STATUS_KIND[g.status]}>{STATUS_LABEL[g.status] || g.status}</Chip></td>
              <td className="hint">{g.note || '—'}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <Btn sm onClick={() => open(g)}>编辑</Btn>
                <Btn sm onClick={() => del(g)}>删除</Btn>
              </td>
            </tr>
          ))}
          {grants && !grants.length && <tr><td colSpan={12}><Hint>暂无期权授予记录</Hint></td></tr>}
        </table>
      </Card>

      {summary && (
        <div className="grid g2" style={{ marginTop: 14 }}>
          <Card title="摊销分布（按员工）">
            <table>
              <tr><th>员工</th><th>部门</th><th>月摊销</th><th>授予价值</th></tr>
              {summary.byEmployee.map(x => (
                <tr key={x.employee_id}>
                  <td><b>{x.name}</b></td><td>{x.department || '—'}</td>
                  <td style={{ color: '#dc2626' }}>¥{x.monthly_amort.toLocaleString('zh-CN')}</td>
                  <td>{formatWan(x.total_value)}</td>
                </tr>
              ))}
            </table>
          </Card>
          <Card title="摊销分布（按部门）">
            <table>
              <tr><th>部门</th><th>月摊销</th><th>授予价值</th><th>占比</th></tr>
              {summary.byDept.map(x => (
                <tr key={x.name}>
                  <td><b>{x.name}</b></td>
                  <td style={{ color: '#dc2626' }}>¥{x.monthly.toLocaleString('zh-CN')}</td>
                  <td>{formatWan(x.total)}</td>
                  <td>{summary.totalMonthly ? Math.round(x.monthly / summary.totalMonthly * 100) + '%' : '—'}</td>
                </tr>
              ))}
            </table>
          </Card>
        </div>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div className="modal" style={{ width: 600 }}>
            <h3>{editing === 'new' ? '新增期权授予' : '编辑授予 · ' + editing.employee_name}</h3>
            <div className="grid g2">
              <Field label="员工">
                <select value={form.employee_id || ''} onChange={set('employee_id')}>
                  <option value="">— 选择员工 —</option>
                  {emps.map(e => <option key={e.id} value={e.id}>{e.name}（{e.grade}·{e.job_family}）</option>)}
                </select>
              </Field>
              <Field label="授予日期"><input type="date" value={form.grant_date || ''} onChange={set('grant_date')} /></Field>
              <Field label="授予股数（万股）"><input type="number" step="0.01" value={form.share_count} onChange={set('share_count')} /></Field>
              <Field label="行权价（元）"><input type="number" step="0.01" value={form.exercise_price} onChange={set('exercise_price')} /></Field>
              <Field label="公允价（元/股）"><input type="number" step="0.01" value={form.fair_value} onChange={set('fair_value')} /></Field>
              <Field label="归属期（月）"><input type="number" value={form.vesting_months} onChange={set('vesting_months')} /></Field>
              <Field label="Cliff（月）"><input type="number" value={form.cliff_months} onChange={set('cliff_months')} /></Field>
              <Field label="状态">
                <select value={form.status} onChange={set('status')}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="备注" style={{ gridColumn: '1 / -1' }}><input value={form.note} onChange={set('note')} /></Field>
            </div>
            {form.share_count && form.fair_value && (
              <Hint style={{ marginTop: 8 }}>授予价值 = {form.share_count}万 × ({form.fair_value}−{form.exercise_price}) = <b>{formatWan(Math.round(form.share_count * 10000 * (form.fair_value - form.exercise_price)))}</b>；月摊销 = <b>¥{Math.round(form.share_count * 10000 * (form.fair_value - form.exercise_price) / (form.vesting_months || 48)).toLocaleString('zh-CN')}</b>/月</Hint>
            )}
            <div className="row">
              <Btn onClick={() => setEditing(null)}>取消</Btn>
              <Btn primary onClick={save}>保存</Btn>
            </div>
          </div>
        </Modal>
      )}

      {editingPool && (
        <Modal onClose={() => setEditingPool(false)}>
          <div className="modal">
            <h3>期权池设置</h3>
            <div className="grid g2">
              <Field label="池占比（%）"><input type="number" value={poolForm.pool_percent} onChange={e => setPoolForm({ ...poolForm, pool_percent: +e.target.value })} /></Field>
              <Field label="总股数（万股）"><input type="number" value={poolForm.total_shares} onChange={e => setPoolForm({ ...poolForm, total_shares: +e.target.value })} /></Field>
              <Field label="估值（万元）" style={{ gridColumn: '1 / -1' }}><input type="number" value={poolForm.valuation_wan} onChange={e => setPoolForm({ ...poolForm, valuation_wan: +e.target.value })} /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setEditingPool(false)}>取消</Btn>
              <Btn primary onClick={savePool}>保存</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
