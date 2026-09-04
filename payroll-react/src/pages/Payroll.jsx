import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field } from '../components/ui.jsx'
import { getPayroll, submitPayroll, downloadPayrollExport } from '../api.js'
import { CAN_FINANCE } from '../data.js'
import { currentPeriod, periodOptions } from '../lib/period.js'

export default function Payroll({ toast, backendUp, user }) {
  const [month, setMonth] = useState(currentPeriod())
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cat, setCat] = useState('all') // 岗位类别筛选

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const d = await getPayroll(month)
        if (alive) { setRows(d.rows); setSubmitted(Boolean(d.run)) }
      } catch {
        if (alive) {
          setRows([]); setSubmitted(false)
          toast(backendUp ? '工资数据加载失败' : '后端不可用，无法读取工资数据')
        }
      } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [month, backendUp])

  const canSubmit = CAN_FINANCE(user?.role)
  const visible = rows ? (cat === 'all' ? rows : rows.filter(r => r.category === cat)) : []
  const CAT_TABS = [['all', '全部'], ['tech', '技术'], ['support', '职能'], ['mgmt', '管理']]
  const toggle = i => setOpen(o => ({ ...o, [i]: !o[i] }))
  const download = async type => {
    const names = { tax: '个税扣缴核对明细', social: '社保公积金核对明细', bank: '银行代发清单' }
    try {
      const blob = await downloadPayrollExport(month, type)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${names[type]}-${month}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
      toast(`已下载 ${names[type]}-${month}.csv`)
    } catch (error) { toast(error.message || '导出失败（后端不可用）') }
  }
  const submit = async () => {
    if (!backendUp) return toast('后端不可用，月结未提交')
    try { await submitPayroll(month); setSubmitted(true); toast('财务已锁定本月工资') }
    catch (error) { toast('提交失败：' + error.message) }
  }
  const total = rows?.reduce((s, r) => s + (parseInt(String(r.net).replace(/,/g, '')) || 0), 0)

  return (
    <>
      <div className="toolbar">
        <Field label="核算月份"><select value={month} onChange={e => setMonth(e.target.value)}>{periodOptions().map(p => <option key={p}>{p}</option>)}</select></Field>
        <Chip kind={submitted ? 'ok' : visible.some(r => r.flags?.some?.(f => f.kind === 'bad')) ? 'bad' : 'info'}>{submitted ? '财务已锁定' : visible.some(r => r.flags?.some?.(f => f.kind === 'bad')) ? '预检存在阻断项' : '待财务复核'}</Chip>
        <Hint>{loading ? '加载中…' : `${rows?.length || 0} 名员工 · 规则引擎生成`}{!canSubmit && !submitted ? ' · 请财务或 CEO 锁定月结' : ''}</Hint>
        <div style={{ flex: 1 }} />
        <Btn sm disabled={!submitted || !canSubmit} onClick={() => download('tax')}>导出个税核对</Btn>
        <Btn sm disabled={!submitted || !canSubmit} onClick={() => download('social')}>导出社保核对</Btn>
        <Btn sm disabled={!submitted || !canSubmit} onClick={() => download('bank')}>导出代发清单</Btn>
        <Btn primary disabled={submitted || !canSubmit || !backendUp} onClick={submit}>{submitted ? '财务已锁定' : '财务复核并锁定'}</Btn>
      </div>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        {CAT_TABS.map(([k, label]) => (
          <button key={k} className={`btn sm ${cat === k ? 'primary' : ''}`} onClick={() => setCat(k)}>{label}{k !== 'all' ? `（${rows?.filter(r => r.category === k).length || 0}）` : ''}</button>
        ))}
      </div>
      <Card>
        <table>
          <tr><th>员工</th><th>类别</th><th>基本</th><th>绩效</th><th>加班</th><th>社保/公积金</th><th>个税</th><th>实发</th><th>差异标记</th></tr>
          {visible.map((row, i) => (
            <FragmentRow key={row.name} row={row} open={open[i]} toggle={() => toggle(i)} />
          ))}
          {visible.length ? (
            <tr className="total-row"><td>合计（{visible.length} 人）</td><td colSpan={5}></td><td></td><td><b>{(visible.reduce((s, r) => s + (parseInt(String(r.net).replace(/,/g, '')) || 0), 0)).toLocaleString('zh-CN')}</b></td><td><Chip kind="ok">个税倒推 ✓</Chip></td></tr>
          ) : <tr><td colSpan={9}><Hint>该类别本月无员工</Hint></td></tr>}
        </table>
        <Hint style={{ marginTop: 10 }}>规则引擎预检：阻断项 {visible.filter(r => r.flags?.some?.(f => f.kind === 'bad')).length} 人。政策未完成官方复核、最低工资异常或加班费存疑时不能月结。导出 CSV 是内部核对/导入清单，上线前仍须按当地税社与银行当期模板验收。</Hint>
      </Card>
    </>
  )
}

function FragmentRow({ row, open, toggle }) {
  const flag = row.flags?.[0] || row.flag || null
  return (
    <>
      <tr>
        <td>{row.name} <Chip kind="gray">{row.grade}</Chip>{row.status === 'departed' && <Chip kind="warn">离职</Chip>}</td>
        <td>{row.category === 'tech' ? '技术' : row.category === 'support' ? '职能' : row.category === 'mgmt' ? '管理' : '—'}</td>
        <td>{row.base}</td><td>{row.perf}</td><td>{row.ot}</td><td>{row.sf}</td><td>{row.tax}</td><td><b>{row.net}</b></td>
        <td>{flag ? <span className={`chip ${flag.kind}`} style={flag.detail ? { cursor: 'pointer' } : undefined} onClick={flag.detail ? toggle : undefined}>{flag.text}</span> : <span className="hint">—</span>}</td>
      </tr>
      {flag?.detail && open && (
        <tr style={{ background: '#fafbfe' }}><td colSpan="9"><Hint>{flag.detail}</Hint></td></tr>
      )}
    </>
  )
}
