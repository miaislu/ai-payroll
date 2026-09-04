import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field } from '../components/ui.jsx'
import { getBenchmarkDirections, getBenchmarkCard, draftBand } from '../api.js'

export default function Benchmark({ toast, backendUp }) {
  const [dirs, setDirs] = useState(null)
  const [q, setQ] = useState({ direction: '模拟IC设计' })
  const [remoteCard, setRemoteCard] = useState(null)
  const set = k => e => setQ({ ...q, [k]: e.target.value })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const list = await getBenchmarkDirections()
        if (alive) {
          setDirs(list)
          setQ(prev => list.some(item => item.direction === prev.direction) ? prev : { direction: list[0]?.direction || '' })
        }
      } catch { if (alive) setDirs([]) }
    })()
    return () => { alive = false }
  }, [backendUp])

  useEffect(() => {
    if (!backendUp) { setRemoteCard(null); return }
    let alive = true
    getBenchmarkCard(q).then(c => alive && setRemoteCard(c)).catch(() => alive && setRemoteCard(null))
    return () => { alive = false }
  }, [q, backendUp])

  const card = remoteCard

  return (
    <>
      <Card>
        <div className="toolbar">
          <Field label="岗位方向"><select value={q.direction} onChange={set('direction')}>{(dirs || []).map(d => <option key={d.direction}>{d.direction}</option>)}</select></Field>
          <Chip kind="gray">固定口径：上海 · 3-5年 · Fabless · 现金年薪</Chip>
        </div>
        <Hint>数据源：后端对标库 + 经审阅导入样本（CSV/JSON，不做平台抓取）。后端不可用时不展示演示或推测值。</Hint>
      </Card>

      {!card && <Card>
        <Hint>{backendUp ? '该方向尚无完整带宽。导入至少 5 条同口径样本并完成审批后，才能用于 Offer 分位判断。' : '后端不可用，无法提供可核验的市场带宽。'}</Hint>
        {backendUp && q.direction && <div style={{ marginTop: 10 }}><Btn sm onClick={async () => {
          try {
            const r = await draftBand({ direction: q.direction })
            toast(`已生成待审带宽 ${r.id}：${r.key}`)
          } catch (e) { toast(e.message || '生成失败') }
        }}>从同口径样本生成带宽草稿</Btn></div>}
      </Card>}

      {card && (
        <Card title={<>带宽卡片 <Chip kind={card.verified ? 'ok' : 'warn'}>{card.verified ? '已审批' : '未核验'}</Chip><Chip kind="info">置信度：{card.conf}</Chip>{card.evidence && <Chip kind="gray">证据：{card.evidence}</Chip>}</>}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{q.direction} · {card.scope}</div>
          <div className="band">
            <div className="b"><div className="t">现金 P25</div><div className="v">{card.p25}万</div></div>
            <div className="b p50"><div className="t">现金 P50</div><div className="v">{card.p50}万</div></div>
            <div className="b"><div className="t">现金 P75</div><div className="v">{card.p75}万</div></div>
          </div>
          <div className="grid g2">
            <div>
              <Hint>审批样本数：<b>{card.sample || '未记录'}</b>{card.verified ? ' 条' : ''}</Hint>
              <Hint style={{ marginTop: 4 }}>不使用无来源的城市、经验、公司类型或融资轮次系数进行外推。</Hint>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'flex-end' }}>
              <Btn sm primary onClick={async () => {
                try {
                  const r = await draftBand({ direction: q.direction })
                  toast(`已生成待审带宽 ${r.id}：${r.key}`)
                } catch (e) { toast(e.message || '生成失败') }
              }}>生成带宽</Btn>
            </div>
          </div>
          {card.sources?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Hint>来源记录（内容仍须人工复核）：</Hint>
              <ul style={{ margin: '6px 0 0', fontSize: 13 }}>
                {card.sources.map((source, index) => (
                  <li key={`${source.title || 'source'}-${index}`}>
                    {/^https?:\/\//i.test(String(source.url || ''))
                      ? <a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>
                      : (source.title || '未命名来源')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Card title="市场趋势">
        <Hint>尚未接入可追溯的时序样本，因此不生成合成趋势曲线。当前卡片只展示已导入样本计算出的截面分位。</Hint>
      </Card>
    </>
  )
}
