import { useMemo, useState } from 'react'
import Chart from '../components/Chart.jsx'
import { Card, Chip, Hint, Btn } from '../components/ui.jsx'
import { optionMetrics, optionSensitivity } from '../lib/calc.js'

export default function Option() {
  const [inp, setInp] = useState({ n: 10, k: 0.5, v0yi: 20, shares: 2500, dil: 30, vest: 4, lq: 0.7, p: { ipo: 10, acq: 15, hold: 45, fail: 30 }, mI: 3, mA: 1.8 })
  const [taxMode, setTaxMode] = useState(true)
  const num = k => e => setInp({ ...inp, [k]: +e.target.value })
  const pct = k => e => setInp({ ...inp, p: { ...inp.p, [k]: +e.target.value } })
  const mult = k => e => setInp({ ...inp, [k]: +e.target.value })

  const r = useMemo(() => optionMetrics(inp, taxMode), [inp, taxMode])
  const sens = useMemo(() => optionSensitivity(inp, taxMode), [inp, taxMode])

  return (
    <>
      <div className="sim-grid">
        <Card title="授予信息">
          <Slider label="授予股数" value={inp.n} onChange={num('n')} unit="万股" type="number" min={1} />
          <Slider label="行权价" value={inp.k} onChange={num('k')} unit="元/股" type="number" min={0} step={0.1} />
          <Slider label="投后估值" value={inp.v0yi} onChange={num('v0yi')} unit="亿元" type="number" min={1} />
          <Slider label="总股本" value={inp.shares} onChange={num('shares')} unit="万股" type="number" min={100} step={100} />
          <Slider label="未来稀释" value={inp.dil} onChange={num('dil')} unit="%" type="number" min={0} max={60} />
          <Slider label="归属年限" value={inp.vest} onChange={num('vest')} unit="年" type="number" min={1} max={6} />
          <Slider label="流动性折价" value={inp.lq} onChange={num('lq')} unit="" type="range" min={0.5} max={1} step={0.05} />
          <div style={{ marginTop: 10 }} className="hint">税负模式</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <Btn sm primary={taxMode} onClick={() => setTaxMode(true)}>递延（转让时 20%）</Btn>
            <Btn sm primary={!taxMode} onClick={() => setTaxMode(false)}>非递延（行权时累进）</Btn>
          </div>
        </Card>
        <Card title={<>场景与概率 <Hint style={{ display: 'inline' }}>半导体行业参考区间，可调（附录 E.5）</Hint></>}>
          <Slider label="IPO（科创板等）" value={inp.p.ipo} onChange={pct('ipo')} unit="%" type="range" min={0} max={60} />
          <Slider label="被并购" value={inp.p.acq} onChange={pct('acq')} unit="%" type="range" min={0} max={60} />
          <Slider label="继续持有" value={inp.p.hold} onChange={pct('hold')} unit="%" type="range" min={0} max={80} />
          <Slider label="失败/僵死" value={inp.p.fail} onChange={pct('fail')} unit="%" type="range" min={0} max={80} />
          <Slider label="IPO 退出倍数" value={inp.mI} onChange={mult('mI')} unit="x" type="range" min={1} max={8} step={0.5} />
          <Slider label="并购退出倍数" value={inp.mA} onChange={mult('mA')} unit="x" type="range" min={0.5} max={4} step={0.5} />
          <Hint style={{ marginTop: 6 }}>概率会自动归一化到 100%。⚠️ 结果为区间而非承诺，对假设高度敏感（附录 E.5 诚实性设计）。</Hint>
        </Card>
      </div>

      <Card title={<>模拟结果 <Chip kind="info">税负模式：{taxMode ? '递延（转让时 20%）' : '非递延（行权时累进）'}</Chip></>}>
        <div className="result-band">
          <div className="rb cons"><div className="t">保守</div><div className="v">{r.cons}万</div><div className="t">万（税后）</div></div>
          <div className="rb mid"><div className="t">中性（期望）</div><div className="v">{r.mid}万</div><div className="t">万（税后）</div></div>
          <div className="rb opt"><div className="t">乐观</div><div className="v">{r.opt}万</div><div className="t">万（税后）</div></div>
        </div>
        <div className="equiv">
          <div><div className="t" style={{ fontSize: 12, color: 'var(--muted)' }}>≈ 等值现金年薪（按归属期 + 流动性折价）</div><div className="big">≈ {r.equiv} 万/年</div></div>
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>敏感性：退出估值 ×2 → 中性值 <b style={{ color: 'var(--accent)' }}>{r.sens}%</b><br />条款：离职 180 天行权窗口 · 并购双触发加速</div>
        </div>
      </Card>

      <Card title={<>敏感性：中性期权价值 vs IPO 退出倍数 <Hint style={{ display: 'inline' }}>拖动上方概率/倍数实时联动</Hint></>}>
        <Chart type="line" data={sens} color="#16a34a" ySuffix="万" />
        <Hint style={{ marginTop: 8 }}>曲线越陡，说明价值对 IPO 估值假设越敏感——和候选人谈期权时，优先对齐"估值预期"而非纠结股数。</Hint>
      </Card>
    </>
  )
}

function Slider({ label, value, onChange, unit, type = 'range', min, max, step }) {
  const show = type === 'range' ? `${value}${unit}` : null
  return (
    <div className="slider-row">
      <span style={{ width: 70 }}>{label}</span>
      {type === 'range' ? (
        <input type="range" min={min} max={max} step={step} value={value} onChange={onChange} />
      ) : (
        <input type="number" min={min} max={max} step={step} value={value} onChange={onChange} style={{ width: 90 }} />
      )}
      {type === 'range' ? <span className="val">{show}</span> : <span>{unit}</span>}
    </div>
  )
}
