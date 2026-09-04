import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getExpenseClaims, createExpenseClaim, expenseClaimAction, deleteExpenseClaim, getAdvances, createAdvance, advanceAction, deleteAdvance } from '../api.js'
import { CAN_FINANCE } from '../data.js'

const EXPENSE_TYPES = ['差旅', '餐饮', '交通', '办公', '招待', '其他']
const CLAIM_STATUS = { submitted: ['待审批', 'warn'], approved: ['已通过', 'ok'], rejected: ['已驳回', 'bad'], paid: ['已打款', 'info'], draft: ['草稿', 'gray'] }
const ADV_STATUS = { submitted: ['待审批', 'warn'], approved: ['已发放', 'ok'], repaid: ['已还款', 'info'], cleared: ['已核销', 'gray'], rejected: ['已驳回', 'bad'] }
const CLAIM_EMPTY = { expense_type: '差旅', amount: '', claim_date: new Date().toISOString().slice(0, 10), description: '', advance_offset: 0 }
const ADV_EMPTY = { amount: '', reason: '', advance_date: new Date().toISOString().slice(0, 10) }

export default function Expenses({ toast, backendUp, user }) {
  const canAct = CAN_FINANCE(user?.role)
  const [claims, setClaims] = useState(null)
  const [advances, setAdvances] = useState(null)
  const [claimForm, setClaimForm] = useState(null) // 打开报销表单
  const [advForm, setAdvForm] = useState(null)

  const load = async () => {
    try {
      const [c, a] = await Promise.all([getExpenseClaims(), getAdvances()])
      setClaims(c); setAdvances(a)
    } catch { toast('报销数据加载失败') }
  }
  useEffect(() => { load() }, [backendUp])

  const submitClaim = async () => {
    if (!claimForm.amount || Number(claimForm.amount) <= 0) return toast('金额必填')
    try {
      await createExpenseClaim({ ...claimForm, amount: +claimForm.amount, advance_offset: +claimForm.advance_offset || 0 })
      toast('报销已提交'); setClaimForm(null); load()
    } catch { toast('提交失败') }
  }
  const submitAdv = async () => {
    if (!advForm.amount || Number(advForm.amount) <= 0) return toast('金额必填')
    try { await createAdvance({ ...advForm, amount: +advForm.amount }); toast('预支已申请'); setAdvForm(null); load() }
    catch { toast('申请失败') }
  }
  const actClaim = async (c, action) => {
    const comment = action === 'reject' ? (prompt('驳回理由：') || '') : (action === 'pay' ? '' : (prompt('审批意见（可选）：') || ''))
    try { await expenseClaimAction(c.id, { action, comment }); toast(action === 'approve' ? '已通过' : action === 'reject' ? '已驳回' : '已标记打款'); load() }
    catch { toast('操作失败') }
  }
  const actAdv = async (a, action) => {
    const comment = action === 'reject' ? (prompt('驳回理由：') || '') : (prompt('审批意见（可选）：') || '')
    try { await advanceAction(a.id, { action, comment }); toast('已处理'); load() }
    catch { toast('操作失败') }
  }
  const delClaim = async c => { if (!confirm('删除该报销单？')) return; try { await deleteExpenseClaim(c.id); toast('已删除'); load() } catch (e) { toast(e.message.includes('400') ? '已审批的报销不可删除' : '删除失败') } }
  const delAdv = async a => { if (!confirm('删除该预支？')) return; try { await deleteAdvance(a.id); toast('已删除'); load() } catch (e) { toast(e.message.includes('400') ? '已审批的预支不可删除' : '删除失败') } }

  const claimStatus = s => CLAIM_STATUS[s] || [s, 'gray']
  const advStatus = s => ADV_STATUS[s] || [s, 'gray']

  return (
    <>
      <div className="grid g3">
        <Card className="kpi" style={{ margin: 0 }}><div className="label">待审批报销</div><div className="num" style={{ color: '#d97706' }}>{claims?.filter(c => c.status === 'submitted').length || 0} 笔</div></Card>
        <Card className="kpi" style={{ margin: 0 }}><div className="label">本月报销合计</div><div className="num">{formatYuan((claims || []).filter(c => c.status !== 'rejected').reduce((s, c) => s + c.amount, 0))}</div></Card>
        <Card className="kpi" style={{ margin: 0 }}><div className="label">未核销预支</div><div className="num" style={{ color: '#dc2626' }}>{formatYuan((advances || []).reduce((s, a) => s + (a.outstanding || 0), 0))}</div></Card>
      </div>

      <Card title={<>报销单 <Chip kind="info">{claims?.length || 0} 笔</Chip></>} style={{ marginTop: 14 }}>
        <div className="toolbar">
          <Hint>提交报销 → 财务或 CEO 审批（可核销预支）→ 打款</Hint>
          <div style={{ flex: 1 }} />
          <Btn primary onClick={() => setClaimForm(CLAIM_EMPTY)}>+ 提交报销</Btn>
        </div>
        <table>
          <tr><th>员工</th><th>类型</th><th>金额</th><th>发生日期</th><th>说明</th><th>核销预支</th><th>状态</th><th>审批</th><th>操作</th></tr>
          {claims?.map(c => (
            <tr key={c.id}>
              <td><b>{c.employee_name}</b></td>
              <td><Chip kind="info">{c.expense_type}</Chip></td>
              <td style={{ fontWeight: 600 }}>{formatYuan(c.amount)}</td>
              <td>{c.claim_date}</td>
              <td className="hint">{c.description || '—'}</td>
              <td>{c.advance_offset > 0 ? formatYuan(c.advance_offset) : '—'}</td>
              <td><Chip kind={claimStatus(c.status)[1]}>{claimStatus(c.status)[0]}</Chip></td>
              <td>
                {canAct && c.status === 'submitted' ? (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <Btn sm onClick={() => actClaim(c, 'approve')}>通过</Btn>
                    <Btn sm onClick={() => actClaim(c, 'reject')}>驳回</Btn>
                  </span>
                ) : canAct && c.status === 'approved' ? (
                  <Btn sm onClick={() => actClaim(c, 'pay')}>打款</Btn>
                ) : c.status === 'approved' ? (
                  <span className="hint">{c.approver} · {c.approved_at?.slice(0, 10)}</span>
                ) : <span className="hint">—</span>}
              </td>
              <td><Btn sm onClick={() => delClaim(c)}>删除</Btn></td>
            </tr>
          ))}
          {claims && !claims.length && <tr><td colSpan={9}><Hint>暂无报销单</Hint></td></tr>}
        </table>
      </Card>

      <Card title={<>预支 <Chip kind="info">{advances?.length || 0} 笔</Chip></>} style={{ marginTop: 14 }}>
        <div className="toolbar">
          <Hint>员工预支（借款）→ 审批发放 → 报销核销或还款结清</Hint>
          <div style={{ flex: 1 }} />
          <Btn primary onClick={() => setAdvForm(ADV_EMPTY)}>+ 申请预支</Btn>
        </div>
        <table>
          <tr><th>员工</th><th>金额</th><th>事由</th><th>申请日期</th><th>未核销</th><th>状态</th><th>审批</th><th>操作</th></tr>
          {advances?.map(a => (
            <tr key={a.id}>
              <td><b>{a.employee_name}</b></td>
              <td style={{ fontWeight: 600 }}>{formatYuan(a.amount)}</td>
              <td className="hint">{a.reason || '—'}</td>
              <td>{a.advance_date}</td>
              <td style={{ color: (a.outstanding || 0) > 0 ? '#dc2626' : '#10b981' }}>{formatYuan(a.outstanding || 0)}</td>
              <td><Chip kind={advStatus(a.status)[1]}>{advStatus(a.status)[0]}</Chip></td>
              <td>
                {canAct && a.status === 'submitted' ? (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <Btn sm onClick={() => actAdv(a, 'approve')}>发放</Btn>
                    <Btn sm onClick={() => actAdv(a, 'reject')}>驳回</Btn>
                  </span>
                ) : canAct && a.status === 'approved' ? (
                  <Btn sm onClick={() => actAdv(a, 'repay')}>还款结清</Btn>
                ) : <span className="hint">{a.approver || '—'}</span>}
              </td>
              <td><Btn sm onClick={() => delAdv(a)}>删除</Btn></td>
            </tr>
          ))}
          {advances && !advances.length && <tr><td colSpan={8}><Hint>暂无预支</Hint></td></tr>}
        </table>
      </Card>

      {claimForm && (
        <Modal onClose={() => setClaimForm(null)}>
          <div className="modal" style={{ width: 520 }}>
            <h3>提交报销</h3>
            <div className="grid g2">
              <Field label="费用类型">
                <select value={claimForm.expense_type} onChange={e => setClaimForm({ ...claimForm, expense_type: e.target.value })}>
                  {EXPENSE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="金额（元）"><input type="number" value={claimForm.amount} onChange={e => setClaimForm({ ...claimForm, amount: e.target.value })} /></Field>
              <Field label="费用发生日期"><input type="date" value={claimForm.claim_date} onChange={e => setClaimForm({ ...claimForm, claim_date: e.target.value })} /></Field>
              <Field label="核销预支金额（可选）"><input type="number" value={claimForm.advance_offset} onChange={e => setClaimForm({ ...claimForm, advance_offset: e.target.value })} /></Field>
              <Field label="说明" style={{ gridColumn: '1 / -1' }}><input value={claimForm.description} onChange={e => setClaimForm({ ...claimForm, description: e.target.value })} /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setClaimForm(null)}>取消</Btn>
              <Btn primary onClick={submitClaim}>提交</Btn>
            </div>
          </div>
        </Modal>
      )}

      {advForm && (
        <Modal onClose={() => setAdvForm(null)}>
          <div className="modal">
            <h3>申请预支</h3>
            <div className="grid g2">
              <Field label="金额（元）"><input type="number" value={advForm.amount} onChange={e => setAdvForm({ ...advForm, amount: e.target.value })} /></Field>
              <Field label="申请日期"><input type="date" value={advForm.advance_date} onChange={e => setAdvForm({ ...advForm, advance_date: e.target.value })} /></Field>
              <Field label="事由" style={{ gridColumn: '1 / -1' }}><input value={advForm.reason} onChange={e => setAdvForm({ ...advForm, reason: e.target.value })} /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setAdvForm(null)}>取消</Btn>
              <Btn primary onClick={submitAdv}>提交</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
