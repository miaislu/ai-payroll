import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field } from '../components/ui.jsx'
import { getPayroll, submitPayroll, downloadPayrollExport } from '../api.js'
import { CAN_FINANCE } from '../data.js'
import { currentPeriod, periodOptions } from '../lib/period.js'
import { useDialog } from '../components/DialogProvider.jsx'

export default function Payroll({ toast, backendUp, user }) {
  const { prompt: askPrompt } = useDialog()
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
  const blockerCount = rows?.filter(r => r.flags?.some?.(f => f.kind === 'bad')).length || 0
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
    let overrideReason = ''
    if (blockerCount) {
      if (user?.role !== 'founder') return toast(`仍有 ${blockerCount} 名员工存在阻断项，请先修正后再锁定`)
      overrideReason = await askPrompt({
        title: 'CEO 例外锁定月结',
        message: `当前有 ${blockerCount} 名员工存在阻断项。例外提交会写入审计日志，请说明业务原因和后续处理安排。`,
        label: '例外原因（至少 10 字）', required: true, minLength: 10, confirmLabel: '确认例外锁定'
      })
      if (overrideReason === null) return
    }
    try { await submitPayroll(month, overrideReason); setSubmitted(true); toast(blockerCount ? 'CEO 已例外锁定本月工资' : '财务已锁定本月工资') }
    catch (error) { toast('提交失败：' + error.message) }
  }
  const total = rows?.reduce((s, r) => s + (parseInt(String(r.net).replace(/,/g, '')) || 0), 0)

  return (
    <>
      <div className="toolbar">
        <Field label="核算月份"><select value={month} onChange={e => setMonth(e.target.value)}>{periodOptions().map(p => <option key={p}>{p}</option>)}</select></Field>
        <Chip kind={submitted ? 'ok' : blockerCount ? 'bad' : 'info'}>{submitted ? '财务已锁定' : blockerCount ? `预检阻断 ${blockerCount} 人` : '待财务复核'}</Chip>
        <Hint>{loading ? '加载中…' : `${rows?.length || 0} 名员工 · 规则引擎生成`}{!canSubmit && !submitted ? ' · 请财务或 CEO 锁定月结' : ''}</Hint>
        <div style={{ flex: 1 }} />
        <Btn sm disabled={!submitted || !canSubmit} onClick={() => download('tax')}>导出个税核对</Btn>
        <Btn sm disabled={!submitted || !canSubmit} onClick={() => download('social')}>导出社保核对</Btn>
        <Btn sm disabled={!submitted || !canSubmit} onClick={() => download('bank')}>导出代发清单</Btn>
        <Btn primary disabled={submitted || !canSubmit || !backendUp || (blockerCount > 0 && user?.role !== 'founder')} onClick={submit} title={blockerCount && user?.role !== 'founder' ? '请先解决所有阻断项' : undefined}>{submitted ? '财务已锁定' : blockerCount && user?.role === 'founder' ? 'CEO 例外锁定…' : '财务复核并锁定'}</Btn>
      </div>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        {CAT_TABS.map(([k, label]) => (
          <button key={k} className={`btn sm ${cat === k ? 'primary' : ''}`} onClick={() => setCat(k)}>{label}{k !== 'all' ? `（${rows?.filter(r => r.category === k).length || 0}）` : ''}</button>
        ))}
      </div>
      <Card>
        <table>
          <thead><tr><th>员工</th><th>类别</th><th>基本</th><th>绩效</th><th>加班</th><th>社保/公积金</th><th>个税</th><th>实发</th><th>差异标记</th></tr></thead>
          <tbody>
            {visible.map((row, i) => (
              <FragmentRow key={row.name} row={row} open={open[i]} toggle={() => toggle(i)} />
            ))}
            {visible.length ? (
              <tr className="total-row"><td>合计（{visible.length} 人）</td><td colSpan={5}></td><td></td><td><b>{(visible.reduce((s, r) => s + (parseInt(String(r.net).replace(/,/g, '')) || 0), 0)).toLocaleString('zh-CN')}</b></td><td><Chip kind={blockerCount ? 'warn' : 'ok'}>{blockerCount ? '预览待复核' : '个税倒推 ✓'}</Chip></td></tr>
            ) : <tr><td colSpan={9}><Hint>该类别本月无员工</Hint></td></tr>}
          </tbody>
        </table>
        <Hint style={{ marginTop: 10 }}>规则引擎预检：全部员工阻断项 {blockerCount} 人{cat !== 'all' ? `；当前筛选内 ${visible.filter(r => r.flags?.some?.(f => f.kind === 'bad')).length} 人` : ''}。政策未完成官方复核、最低工资异常或加班费存疑时不能月结；仅 CEO 可填写原因后例外锁定。导出 CSV 是内部核对/导入清单，上线前仍须按当地税社与银行当期模板验收。</Hint>
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
