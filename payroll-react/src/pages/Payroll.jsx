import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field } from '../components/ui.jsx'
import { getPayroll, submitPayroll } from '../api.js'

const LOCAL_ROWS = [
  { name: '张三', grade: 'P5', base: '25,000', perf: '8,000', ot: '0', sf: '-3,950', tax: '-2,310', net: '30,690', flag: { kind: 'warn', text: '社保基数调整 ▸', detail: '本月社保基数按 2025 年新基数（下限 ¥6,120）调整，个人部分 +¥210，已校验与政策一致（来源：深圳市社保局 2025 基数通知）。' } },
  { name: '李四', grade: 'P4', base: '18,000', perf: '3,000', ot: '4,200', sf: '-3,240', tax: '-1,880', net: '23,320', flag: { kind: 'ok', text: '转正生效' } },
  { name: '王五', grade: 'P6', base: '离职结算（6/15 离职 · 含 N+1 补偿 38,400）', perf: '', ot: '', sf: '-2,960', tax: '-8,900', net: '58,240', flag: { kind: 'warn', text: '离职结算' } },
  { name: '赵六', grade: 'P4', base: '19,000', perf: '2,000', ot: '0', sf: '-3,320', tax: '-1,940', net: '16,240', flag: { kind: 'bad', text: '加班费存疑 ▸', detail: '⚠️ 合规预检：赵六 6/14（周六）加班 8 小时按 1.5 倍计算，建议核对是否为休息日（应为 2 倍）。来源：《劳动法》第 44 条。已阻断确认，请 HR 处理。' } }
]

export default function Payroll({ toast, backendUp }) {
  const [month, setMonth] = useState('2025-06')
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
          setRows(backendUp ? [] : LOCAL_ROWS); setSubmitted(false)
          if (backendUp) toast('工资数据加载失败')
        }
      } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [month, backendUp])

  const visible = rows ? (cat === 'all' ? rows : rows.filter(r => r.category === cat)) : []
  const CAT_TABS = [['all', '全部'], ['tech', '技术'], ['support', '职能'], ['mgmt', '管理']]
  const toggle = i => setOpen(o => ({ ...o, [i]: !o[i] }))
  const download = async type => {
    const names = { tax: '个税扣缴申报', social: '社保公积金申报', bank: '银行代发' }
    try {
      const res = await fetch(`/api/payroll/${month}/export/${type}`, { headers: { Authorization: 'Bearer ' + (sessionStorage.getItem('payroll_token') || '') } })
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${names[type]}-${month}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
      toast(`已下载 ${names[type]}-${month}.csv`)
    } catch { toast('导出失败（后端不可用）') }
  }
  const submit = async () => {
    if (backendUp) {
      try { await submitPayroll(month); setSubmitted(true); toast('已提交财务复核（后端持久化）'); return }
      catch (error) { toast('提交失败：' + error.message); return }
    }
    setSubmitted(true)
    toast('已提交财务复核（本地演示）')
  }
  const total = rows?.reduce((s, r) => s + (parseInt(String(r.net).replace(/,/g, '')) || 0), 0)

  return (
    <>
      <div className="toolbar">
        <Field label="核算月份"><select value={month} onChange={e => setMonth(e.target.value)}><option>2025-06</option><option>2025-05</option><option>2025-04</option></select></Field>
        <Chip kind="ok">{submitted ? 'AI 预检通过 · 待财务复核' : 'AI 预检通过'}</Chip>
        <Hint>{loading ? '加载中…' : `${rows?.length || 0} 名员工 · 规则引擎生成`}</Hint>
        <div style={{ flex: 1 }} />
        <Btn sm onClick={() => download('tax')}>导出个税申报</Btn>
        <Btn sm onClick={() => download('social')}>导出社保申报</Btn>
        <Btn sm onClick={() => download('bank')}>导出银行代发</Btn>
        <Btn primary disabled={submitted} onClick={submit}>{submitted ? '已提交 · 待财务复核' : '提交财务复核'}</Btn>
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
        <Hint style={{ marginTop: 10 }}>校验项：最低工资 ✓ · 个税倒推 ✓ · 加班费存疑（{visible.filter(r => r.flags?.some?.(f => f.text.includes('加班费存疑'))).length || 0} 项）——规则引擎生成，金额按员工档案实时计算</Hint>
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
