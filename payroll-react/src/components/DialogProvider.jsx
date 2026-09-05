import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Btn, Field, Hint, Modal } from './ui.jsx'

const DialogContext = createContext(null)

function optionsOf(value, fallbackTitle) {
  return typeof value === 'string' ? { title: fallbackTitle, message: value } : { title: fallbackTitle, ...(value || {}) }
}

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const [error, setError] = useState('')

  const open = useCallback((kind, options) => new Promise(resolve => {
    setError('')
    setDialog({ kind, value: String(options.defaultValue ?? ''), ...options, resolve })
  }), [])

  const api = useMemo(() => ({
    confirm: value => open('confirm', optionsOf(value, '请确认')),
    prompt: value => open('prompt', optionsOf(value, '请输入'))
  }), [open])

  const finish = value => {
    const resolve = dialog?.resolve
    setDialog(null)
    setError('')
    resolve?.(value)
  }

  const submit = event => {
    event.preventDefault()
    if (dialog.kind === 'confirm') return finish(true)
    const value = dialog.value.trim()
    if (dialog.required && !value) return setError(dialog.requiredMessage || '请填写后再继续')
    if (dialog.minLength && value.length < dialog.minLength) return setError(`请至少填写 ${dialog.minLength} 个字`)
    finish(value)
  }

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && (
        <Modal onClose={() => finish(dialog.kind === 'confirm' ? false : null)}>
          <form className="modal" style={{ width: 460 }} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
            <h3 id="app-dialog-title">{dialog.title}</h3>
            {dialog.message && <Hint style={{ whiteSpace: 'pre-line', marginBottom: dialog.kind === 'prompt' ? 10 : 0 }}>{dialog.message}</Hint>}
            {dialog.kind === 'prompt' && (
              <Field label={dialog.label || '内容'}>
                <input
                  autoFocus
                  type={dialog.inputType || 'text'}
                  value={dialog.value}
                  placeholder={dialog.placeholder || ''}
                  min={dialog.min}
                  max={dialog.max}
                  onChange={event => { setDialog(current => ({ ...current, value: event.target.value })); setError('') }}
                />
              </Field>
            )}
            {error && <Hint style={{ color: 'var(--bad)', marginTop: 8 }}>{error}</Hint>}
            <div className="row">
              <Btn type="button" onClick={() => finish(dialog.kind === 'confirm' ? false : null)}>{dialog.cancelLabel || '取消'}</Btn>
              <Btn type="submit" primary>{dialog.confirmLabel || '确定'}</Btn>
            </div>
          </form>
        </Modal>
      )}
    </DialogContext.Provider>
  )
}

export function useDialog() {
  const value = useContext(DialogContext)
  if (!value) throw new Error('useDialog 必须在 DialogProvider 内使用')
  return value
}
