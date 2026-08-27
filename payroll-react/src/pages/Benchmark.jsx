import { useEffect, useMemo, useState } from 'react'
import Chart from '../components/Chart.jsx'
import { Card, Chip, Hint, Btn, Field } from '../components/ui.jsx'
import { CITIES, EXPS, TYPES, STAGES, TREND_LABELS, DIRECTIONS as LOCAL_DIRECTIONS } from '../data.js'
import { benchmarkCalc } from '../lib/calc.js'
import { getBenchmarkDirections, getBenchmarkCard } from '../api.js'

export default function Benchmark({ toast, backendUp }) {
  const [dirs, setDirs] = useState(null) // null=未加载；API 数据或本地兜底
  const [q, setQ] = useState({ direction: '模拟IC设计', city: '上海', exp: '3-5年', type: 'Fabless', stage: 'B轮' })
  const set = k => e => setQ({ ...q, [k]: e.target.value })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const list = await getBenchmarkDirections()
        if (alive) setDirs(list)
      } catch { if (alive) setDirs(LOCAL_DIRECTIONS) }
    })()
    return () => { alive = false }
  }, [backendUp])

  // 带宽卡：优先后端计算（真实库数据），后端不可用走本地
  const card = useMemo(() => {
    const row = Array.isArray(dirs) ? dirs.find(d => d.direction === q.direction) : (dirs?.[q.direction])
    if (Array.isArray(dirs)) { // 后端模式：行字段为 p25/p50/p75/rarity/sample/trend/evidence
      const p50 = Math.round(row.p50 * CITIES[q.city] * EXPS[q.exp] * TYPES[q.type])
      const p25 = Math.round(row.p25 * CITIES[q.city] * EXPS[q.exp] * TYPES[q.type])
      const p75 = Math.round(row.p75 * CITIES[q.city] * EXPS[q.exp] * TYPES[q.type])
      const total = Math.round(p50 * (1 + STAGES[q.stage]) * row.rarity)
      return { p25, p50, p75, total, rarity: row.rarity, trend: row.trend, sample: row.sample, hidden: row.sample > 100 ? 18 : 25, conf: row.sample >= 120 ? '高' : (row.sample >= 60 ? '中' : '低'), evidence: row.evidence }
    }
    if (dirs) return benchmarkCalc(dirs[q.direction], q.city, q.exp, q.type, q.stage)
    return null
  }, [dirs, q])

  const trend = useMemo(() => {
    const p50 = card?.p50 || 50
    return TREND_LABELS.map((lb, i) => ({ label: lb, value: Math.round(p50 * (0.95 + 0.028 * Math.sin(i * 1.1) + 0.05 * i / 11)) }))
  }, [card])

  return (
    <>
      <Card>
        <div className="toolbar">
          <Field label="岗位方向"><select value={q.direction} onChange={set('direction')}>{Object.keys(dirs || LOCAL_DIRECTIONS).map(k => <option key={k}>{k}</option>)}</select></Field>
          <Field label="城市"><select value={q.city} onChange={set('city')}>{Object.keys(CITIES).map(k => <option key={k}>{k}</option>)}</select></Field>
          <Field label="经验"><select value={q.exp} onChange={set('exp')}>{Object.keys(EXPS).map(k => <option key={k}>{k}</option>)}</select></Field>
          <Field label="公司类型"><select value={q.type} onChange={set('type')}>{Object.keys(TYPES).map(k => <option key={k}>{k}</option>)}</select></Field>
          <Field label="融资轮次"><select value={q.stage} onChange={set('stage')}>{Object.keys(STAGES).map(k => <option key={k}>{k}</option>)}</select></Field>
        </div>
        <Hint>数据源：{backendUp ? '后端对标库（benchmark-dataset.json 灌库，13 方向 · 含证据强度）' : '本地演示表'} · 岗位归一化（附录 C）· LLM 解析（附录 D）</Hint>
      </Card>

      {card && (
        <Card title={<>带宽卡片 <Chip kind="info">置信度：{card.conf}</Chip>{card.evidence && <Chip kind="gray">证据：{card.evidence}</Chip>}</>}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{q.direction} · {q.city} · {q.exp} · {q.type}（{q.stage}）</div>
          <div className="band">
            <div className="b"><div className="t">现金 P25</div><div className="v">{card.p25}万</div></div>
            <div className="b p50"><div className="t">现金 P50</div><div className="v">{card.p50}万</div></div>
            <div className="b"><div className="t">现金 P75</div><div className="v">{card.p75}万</div></div>
          </div>
          <div className="grid g2">
            <div>
              <Hint>总包（含期权预期，按 {q.stage} 估值）：<b>{card.total}</b> 万/年</Hint>
              <Hint style={{ marginTop: 4 }}>稀缺性系数：<b>{card.rarity.toFixed(2)}</b> · 趋势（3 个月）：<b>{card.trend}</b></Hint>
              <Hint style={{ marginTop: 4 }}>样本：<b>{card.sample}</b> 条（面议按回归估计 {card.hidden}%）</Hint>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'flex-end' }}>
              <Btn sm onClick={() => toast('已加入对比列表（原型演示）')}>加入对比</Btn>
              <Btn sm primary onClick={() => toast('带宽草稿已生成，请在审批中心确认（原型演示）')}>生成带宽</Btn>
            </div>
          </div>
        </Card>
      )}

      <Card title={<>市场趋势 <Hint style={{ display: 'inline' }}>{q.direction} · {q.city} · 近 12 个月 P50</Hint></>}>
        <Chart type="line" data={trend} color="#2f54eb" ySuffix="万" />
        <Hint style={{ marginTop: 8 }}>趋势标注已按《集成电路行业人才洞察报告2024》校准：工艺/设备↑、模拟/数字前后端/测试/软件↓（详见 benchmark-data/benchmark-dataset.json）。曲线为示意走势。</Hint>
      </Card>
    </>
  )
}
