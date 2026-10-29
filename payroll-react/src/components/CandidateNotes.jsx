import { useState } from 'react'
import { updateCandidate } from '../api.js'
import { Btn, Field, Hint } from './ui.jsx'

export const NOTE_LABELS = { high: '高意向', pending: '待定', custom: '自定义' }

export default function CandidateNotes({ candidate, onSaved, toast }) {
  const [saved, setSaved] = useState(candidate.notes || '')
  const [notes, setNotes] = useState(candidate.notes || '')
  const [savedCategory, setSavedCategory] = useState(candidate.notes_category || '')
  const [category, setCategory] = useState(candidate.notes_category || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = notes !== saved || category !== savedCategory
  const save = async () => {
    if (saving || !dirty) return
    setSaving(true); setError('')
    try {
      await updateCandidate(candidate.id, { notes, notes_category: category })
      setSaved(notes); setSavedCategory(category)
      toast('备注已保存')
      await onSaved()
    } catch (err) { setError('保存失败：' + err.message) }
    finally { setSaving(false) }
  }
  return <div style={{ marginTop: 16 }}>
    <Field label="备注选项">
      <select value={category} disabled={saving} onChange={event => { setCategory(event.target.value); setError('') }}>
        <option value="">未选择</option>
        {Object.entries(NOTE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </Field>
    <Field label={category === 'custom' ? '自定义备注' : '补充备注'}>
      <textarea rows={4} maxLength={5000} value={notes} disabled={saving}
        placeholder="填写沟通情况、跟进事项或其他补充信息"
        onChange={event => { setNotes(event.target.value); setError('') }}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 90 }} />
    </Field>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <Hint>{notes.length}/5000{dirty ? ' · 尚未保存' : ' · 已保存'}</Hint>
      <div style={{ flex: 1 }} />
      {dirty && <Btn sm disabled={saving} onClick={() => { setNotes(saved); setCategory(savedCategory); setError('') }}>撤销修改</Btn>}
      <Btn sm primary disabled={saving || !dirty} onClick={save}>{saving ? '保存中…' : '保存备注'}</Btn>
    </div>
    {error && <div role="alert" style={{ color: '#dc2626', marginTop: 6 }}>{error}</div>}
  </div>
}
