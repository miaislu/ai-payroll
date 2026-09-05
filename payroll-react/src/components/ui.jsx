export const Chip = ({ kind = 'info', children }) => <span className={`chip ${kind}`}>{children}</span>

export const Card = ({ title, extra, children, style }) => (
  <div className="card" style={style}>
    {title !== undefined && <h3>{title}{extra}</h3>}
    {children}
  </div>
)

export const Hint = ({ children, style }) => <div className="hint" style={style}>{children}</div>

export const Stepper = ({ steps, current }) => (
  <div className="stepper">
    {steps.map((st, i) => (
      <div key={i} className={`step ${i < current ? 'done' : i === current ? 'current' : ''}`}>{st}</div>
    ))}
  </div>
)

export const Btn = ({ primary, sm, children, onClick, disabled, ...props }) => (
  <button className={`btn ${primary ? 'primary' : ''} ${sm ? 'sm' : ''}`} onClick={onClick} disabled={disabled} {...props}>{children}</button>
)

export const Kpi = ({ label, num, sub, numColor }) => (
  <div className="card kpi" style={{ margin: 0 }}>
    <div className="label">{label}</div>
    <div className="num" style={numColor ? { color: numColor } : undefined}>{num}</div>
    {sub && <div className="sub">{sub}</div>}
  </div>
)

export const Field = ({ label, children }) => (
  <label className="f">{label}{children}</label>
)

export function Modal({ onClose, children }) {
  return (
    <div className="modal-bg show" onClick={e => e.currentTarget === e.target && onClose?.()}>
      {children}
    </div>
  )
}
