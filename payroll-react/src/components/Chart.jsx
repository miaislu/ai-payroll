import { useEffect, useMemo, useRef, useState } from 'react'

const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const fmt = v => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v >= 100 ? Math.round(v) : Math.round(v * 10) / 10)

export default function Chart({ type = 'line', data, color = '#2f54eb', ySuffix = '', refLine = null, area = false }) {
  const box = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const measure = () => setW(box.current?.clientWidth || 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const svg = useMemo(() => {
    if (!data?.length) return '<svg width="100%" height="230" role="img" aria-label="暂无图表数据"><text x="50%" y="50%" text-anchor="middle" fill="#8a94a6">暂无数据</text></svg>'
    const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#2f54eb'
    const W = w || 560, H = 230, padL = 46, padR = 14, padT = 16, padB = 28
    const iw = W - padL - padR, ih = H - padT - padB
    const vals = data.map(d => d.value)
    const rawMin = Math.min(...vals, refLine ? refLine.value : Infinity)
    const rawMax = Math.max(...vals, refLine ? refLine.value : -Infinity)
    let lo = rawMin, hi = rawMax, span = (hi - lo) || 1
    lo -= span * 0.14; hi += span * 0.14
    const X = i => padL + i / (data.length - 1) * iw
    const Y = v => padT + ih - (v - lo) / (hi - lo) * ih
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;width:100%">`
    const steps = 4
    for (let i = 0; i <= steps; i++) {
      const v = lo + (hi - lo) * i / steps, yy = Y(v)
      s += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#eef0f5"/>`
      s += `<text x="${padL - 6}" y="${yy + 3.5}" text-anchor="end" font-size="10" fill="#8a94a6">${fmt(v)}</text>`
    }
    if (type === 'line') {
      data.forEach((d, i) => s += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#8a94a6">${esc(d.label)}</text>`)
      if (refLine) {
        const ry = Y(refLine.value)
        s += `<line x1="${padL}" y1="${ry}" x2="${W - padR}" y2="${ry}" stroke="#d97706" stroke-dasharray="5,4"/><text x="${W - padR}" y="${ry - 5}" text-anchor="end" font-size="10" fill="#d97706">${esc(refLine.label)}</text>`
      }
      const pts = data.map((d, i) => X(i) + ',' + Y(d.value)).join(' ')
      if (area) s += `<polygon points="${padL},${Y(lo)} ${pts} ${X(data.length - 1)},${Y(lo)}" fill="${safeColor}18" stroke="none"/>`
      s += `<polyline points="${pts}" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linejoin="round"/>`
      data.forEach((d, i) => {
        s += `<circle cx="${X(i)}" cy="${Y(d.value)}" r="3" fill="#fff" stroke="${safeColor}" stroke-width="2"/>`
        s += `<circle cx="${X(i)}" cy="${Y(d.value)}" r="10" fill="transparent"><title>${esc(d.label)}：${fmt(d.value)}${ySuffix}</title></circle>`
      })
      const last = data[data.length - 1]
      s += `<text x="${X(data.length - 1)}" y="${Y(last.value) - 10}" text-anchor="middle" font-size="11" font-weight="600" fill="${safeColor}">${fmt(last.value)}${ySuffix}</text>`
    } else {
      const bw = iw / data.length * 0.52, b0 = Y(lo)
      data.forEach((d, i) => {
        const cx = padL + i / data.length * iw + iw / data.length / 2
        const barColor = /^#[0-9a-f]{3,8}$/i.test(d.color || '') ? d.color : safeColor
        s += `<rect x="${cx - bw / 2}" y="${Y(d.value)}" width="${bw}" height="${Math.max(1, b0 - Y(d.value))}" rx="4" fill="${barColor}"/>`
        s += `<text x="${cx}" y="${Y(d.value) - 5}" text-anchor="middle" font-size="10" font-weight="600">${fmt(d.value)}${ySuffix}</text>`
        s += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#8a94a6">${esc(d.label)}</text>`
      })
      if (refLine) {
        const ry = Y(refLine.value)
        s += `<line x1="${padL}" y1="${ry}" x2="${W - padR}" y2="${ry}" stroke="#d97706" stroke-dasharray="5,4"/><text x="${padL + 4}" y="${ry - 5}" font-size="10" fill="#d97706">${esc(refLine.label)}</text>`
      }
    }
    s += '</svg>'
    return s
  }, [w, type, data, color, ySuffix, refLine, area])

  return <div ref={box} dangerouslySetInnerHTML={{ __html: svg }} />
}
