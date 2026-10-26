import { useEffect, useRef, useState } from 'react'
import { matchCandidateRequisitions } from '../api.js'
import { Btn, Chip, Hint } from './ui.jsx'

const fingerprint = profile => JSON.stringify({ skills: profile?.basic?.skills || '', education: profile?.education || [], work: profile?.work_experience || [] })

export default function RequisitionMatcher({ candidateId, profile, selectedId, auto, disabled, onSelect, onReady, onBusyChange }) {
  const [result, setResult] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [matchedProfile, setMatchedProfile] = useState('')
  const current = useRef(), mounted = useRef(false), requestId = useRef(0)
  current.current = { profile, onReady, onBusyChange }
  const run = async () => {
    const id = ++requestId.current, source = current.current.profile, signature = fingerprint(source)
    setBusy(true); setError(''); current.current.onBusyChange?.(true)
    try {
      const value = await matchCandidateRequisitions(candidateId, source)
      if (!mounted.current || id !== requestId.current) return
      setResult(value); setMatchedProfile(signature)
      if (signature === fingerprint(current.current.profile)) current.current.onReady?.(value)
    } catch (failure) { if (mounted.current && id === requestId.current) setError(failure.message) }
    finally {
      if (mounted.current && id === requestId.current) { setBusy(false); current.current.onBusyChange?.(false) }
    }
  }
  useEffect(() => {
    mounted.current = true
    let active = true
    Promise.resolve().then(() => { if (active && auto) run() })
    return () => { active = false; mounted.current = false; ++requestId.current; current.current.onBusyChange?.(false) }
  }, [candidateId])
  return <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, background: '#f8fafc', margin: '14px 0' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <h4 style={{ margin: 0 }}>关联岗位自动匹配</h4>
      <Btn sm disabled={busy || disabled} onClick={run}>{busy ? '本机模型匹配中…' : result ? '重新匹配岗位' : '自动匹配岗位'}</Btn>
    </div>
    <Hint>根据专业技能和任职经历匹配当前在招需求。建议岗位与个人资料一起确认保存。</Hint>
    {busy && <Hint>正在对照在招岗位的职责，本机处理可能需要几十秒，请稍候。</Hint>}
    {error && <p role="alert" style={{ color: '#b42318', fontSize: 13 }}>匹配未完成：{error}。可手动选择下方关联岗位。</p>}
    {result && <>
      <p style={{ fontSize: 13 }}>{result.message}</p>
      {matchedProfile !== fingerprint(profile) && <Hint>职业资料已修改，可点击「重新匹配岗位」更新建议。</Hint>}
      {(result.matches || []).map(item => <div key={item.requisition_id} style={{ padding: 10, marginTop: 8, border: `1px solid ${Number(selectedId) === item.requisition_id ? '#2f54eb' : 'var(--line)'}`, borderRadius: 8, background: '#fff' }}>
        <b style={{ fontSize: 13 }}>{item.title}</b> <Chip kind={item.confidence === 'high' ? 'ok' : 'warn'}>{item.confidence === 'high' ? '工作方向直接对应' : '部分相关，需核对'}</Chip>
        {item.city && <Hint>{item.city}</Hint>}
        <p style={{ fontSize: 13, margin: '6px 0' }}>{item.reason}</p>
        <Hint>简历依据：{item.evidence.join('；')}</Hint>
        <Btn sm disabled={busy || disabled} onClick={() => onSelect(String(item.requisition_id))}>{Number(selectedId) === item.requisition_id ? '已选，待确认保存' : '选择此岗位'}</Btn>
      </div>)}
    </>}
  </div>
}
