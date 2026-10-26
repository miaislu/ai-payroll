import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getChannels, createChannel, updateChannel, deleteChannel, createChannelExpense, deleteChannelExpense, getRecruitingStats } from '../api.js'
import { formatWanInt } from '../lib/format.js'
import { currentPeriod } from '../lib/period.js'
import { useDialog } from '../components/DialogProvider.jsx'
import { CANDIDATE_STAGES } from '../data.js'
import { exactExpectedSalary } from '../lib/candidate-salary.js'

const TYPE_LABEL = { job_board: '招聘平台', headhunter: '猎头', employee_ref: '内推', university: '校园招聘', other: '其他' }
const EMPTY_CHANNEL = {
  name: '', type: 'job_board', contact: '', contact_info: '', note: '', fee_basis_months: '', fee_rate: '', guarantee_months: '',
  payment_account_name: '', payment_account_number: '', payment_bank: ''
}
const feeBasisOptions = [6, 12, 13, 15]
const guaranteeOptions = [0, 1, 2, 3, 6, 12]
const stageLabel = key => CANDIDATE_STAGES.find(item => item.key === key)?.label || key
const maskAccount = value => {
  const text = String(value || '').replace(/\s/g, '')
  return text ? `${'*'.repeat(Math.min(8, Math.max(4, text.length - 4)))}${text.slice(-4)}` : ''
}

export default function Channels({ toast, backendUp }) {
  const { confirm: askConfirm } = useDialog()
  const [list, setList] = useState(null)
  const [stats, setStats] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_CHANNEL)
  const [exp, setExp] = useState(null) // 当前添加费用的渠道

  const load = async () => {
    try { setList(await getChannels()); setStats(await getRecruitingStats()) } catch { toast('渠道数据加载失败') }
  }
  useEffect(() => { load() }, [backendUp])

  const save = async () => {
    if (!form.name.trim()) return toast('渠道名称必填')
    try {
      if (editing === 'new') { await createChannel(form); toast('已添加渠道') }
      else { await updateChannel(editing.id, form); toast('已保存') }
      setEditing(null); load()
    } catch { toast('保存失败') }
  }
  const del = async c => {
    if (!await askConfirm({ title: '删除招聘渠道', message: `将删除渠道“${c.name}”及其费用记录。`, confirmLabel: '删除' })) return
    try { await deleteChannel(c.id); toast('已删除'); load() } catch { toast('删除失败') }
  }
  const addExpense = async () => {
    if (!exp.amount) return toast('填写金额')
    if (exp.channel_type === 'headhunter' && !exp.candidate_id) return toast('猎头费用必须选择关联候选人')
    try {
      await createChannelExpense({ channel_id: exp.channel_id, candidate_id: exp.candidate_id || null, year_month: exp.year_month || currentPeriod(), amount: +exp.amount, note: exp.note || '' })
      toast('已记录费用'); setExp(null); load()
    } catch { toast('记录失败') }
  }
  const pickExpenseCandidate = candidateId => {
    const candidate = exp.candidates?.find(item => item.id === Number(candidateId))
    const salary = Number(candidate?.offer_amount || exactExpectedSalary(candidate))
    const suggested = salary && exp.fee_basis_months && exp.fee_rate != null
      ? Math.round(salary * Number(exp.fee_basis_months) * Number(exp.fee_rate) / 100)
      : ''
    setExp({ ...exp, candidate_id: candidate?.id || null, amount: suggested, salary, suggested })
  }
  const delExpense = async (channelId, eid) => {
    if (!await askConfirm({ title: '删除费用记录', message: '删除后该笔费用将不再计入招聘成本。', confirmLabel: '删除' })) return
    try { await deleteChannelExpense(eid); toast('已删除'); load() } catch { toast('删除失败') }
  }

  return (
    <>
      <div className="grid g4">
        <Card className="kpi" style={{ margin: 0 }}><div className="label">累计渠道费用</div><div className="num">{stats ? formatWanInt(stats.totalCost) : '—'}</div></Card>
        <Card className="kpi" style={{ margin: 0 }}><div className="label">人均招聘成本</div><div className="num" style={{ color: '#d97706' }}>{stats ? formatWanInt(stats.costPerHire) : '—'}</div><div className="sub">累计费用 ÷ 入职人数</div></Card>
        <Card className="kpi" style={{ margin: 0 }}><div className="label">已入职</div><div className="num" style={{ color: '#10b981' }}>{stats?.hires || 0} 人</div></Card>
        <Card className="kpi" style={{ margin: 0 }}><div className="label">Offer 接受率</div><div className="num" style={{ color: '#2f54eb' }}>{stats?.acceptRate || 0}%</div></Card>
      </div>

      <Card title={<>招聘渠道 <Chip kind="info">{list?.length || 0} 个</Chip></>} style={{ marginTop: 14 }}>
        <div className="toolbar">
          <Hint>渠道 = 来源 + 费用；费用按月记录，自动进入「薪酬成本-招聘成本」预算口径</Hint>
          <div style={{ flex: 1 }} />
          <Btn primary onClick={() => { setForm(EMPTY_CHANNEL); setEditing('new') }}>+ 添加渠道</Btn>
        </div>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 1240 }}>
          <thead><tr><th>渠道</th><th>类型</th><th>联系人</th><th>推荐人选</th><th>猎头收费标准</th><th>付款信息</th><th>备注</th><th>费用记录</th><th>操作</th></tr></thead>
          <tbody>
          {list?.map(c => (
            <tr key={c.id}>
              <td><b>{c.name}</b></td>
              <td><Chip kind="info">{TYPE_LABEL[c.type] || c.type}</Chip></td>
              <td><div>{c.contact || '—'}</div><div className="hint">{c.contact_info || '—'}</div></td>
              <td>
                {c.candidates?.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {c.candidates.map(candidate => <span key={candidate.id} style={{ fontSize: 12 }}><b>{candidate.name}</b> · {stageLabel(candidate.stage)}<br /><span className="hint">{candidate.requisition_title || '未关联需求'}</span></span>)}
                </div> : <span className="hint">暂无</span>}
              </td>
              <td className="hint">
                {c.type === 'headhunter' ? <>
                  <div>计费：{c.fee_basis_months ? `${c.fee_basis_months} 个月月薪` : '未设置'}{c.fee_rate != null ? ` × ${c.fee_rate}%` : ''}</div>
                  <div>保证期：{c.guarantee_months != null ? `${c.guarantee_months} 个月` : '未设置'}</div>
                </> : '—'}
              </td>
              <td className="hint">
                {c.type === 'headhunter' && (c.payment_account_name || c.payment_bank || c.payment_account_number) ? <>
                  <div>{c.payment_account_name || '—'} · {c.payment_bank || '—'}</div>
                  {c.payment_account_number && <div>账号 {maskAccount(c.payment_account_number)}</div>}
                </> : '—'}
              </td>
              <td className="hint">{c.note || '—'}</td>
              <td>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {c.expenses?.map(e => (
                    <span key={e.id} style={{ fontSize: 12 }}>
                      {e.year_month}：{formatWanInt(e.amount)}{e.candidate_name ? ` · ${e.candidate_name}` : ''}
                      <span style={{ color: '#dc2626', cursor: 'pointer', marginLeft: 4 }} onClick={() => delExpense(c.id, e.id)}>✕</span>
                    </span>
                  ))}
                  <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setExp({ channel_id: c.id, channel_name: c.name, channel_type: c.type, candidates: c.candidates || [], fee_basis_months: c.fee_basis_months, fee_rate: c.fee_rate, year_month: currentPeriod(), candidate_id: null, amount: '', note: '' })}>+ 记费用</button>
                </div>
              </td>
              <td style={{ display: 'flex', gap: 6 }}>
                <Btn sm onClick={() => { setForm({ ...EMPTY_CHANNEL, ...c }); setEditing(c) }}>编辑</Btn>
                <Btn sm onClick={() => del(c)}>删除</Btn>
              </td>
            </tr>
          ))}
          {list && !list.length && <tr><td colSpan={9}><Hint>暂无渠道</Hint></td></tr>}
          </tbody>
        </table>
        </div>
      </Card>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div className="modal" style={{ width: 700 }}>
            <h3>{editing === 'new' ? '添加渠道' : '编辑渠道'}</h3>
            <div className="grid g2">
              <Field label="渠道名称"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="类型">
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="联系人"><input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} /></Field>
              <Field label="联系方式（手机 / 微信 / 邮箱）"><input value={form.contact_info || ''} onChange={e => setForm({ ...form, contact_info: e.target.value })} /></Field>
              <Field label="备注" style={{ gridColumn: '1 / -1' }}><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field>
              {form.type === 'headhunter' && <>
                <Field label="计费依据">
                  <select value={form.fee_basis_months ?? ''} onChange={e => setForm({ ...form, fee_basis_months: e.target.value })}>
                    <option value="">— 请选择 —</option>
                    {feeBasisOptions.map(value => <option key={value} value={value}>{value} 个月月薪</option>)}
                  </select>
                </Field>
                <Field label="费率（%）"><input type="number" min="0" max="100" step="0.1" value={form.fee_rate ?? ''} onChange={e => setForm({ ...form, fee_rate: e.target.value })} placeholder="例如 20" /></Field>
                <Field label="保证期">
                  <select value={form.guarantee_months ?? ''} onChange={e => setForm({ ...form, guarantee_months: e.target.value })}>
                    <option value="">— 请选择 —</option>
                    {guaranteeOptions.map(value => <option key={value} value={value}>{value === 0 ? '无保证期' : `${value} 个月`}</option>)}
                  </select>
                </Field>
                <div />
                <Field label="账户名"><input value={form.payment_account_name || ''} onChange={e => setForm({ ...form, payment_account_name: e.target.value })} /></Field>
                <Field label="账号"><input value={form.payment_account_number || ''} onChange={e => setForm({ ...form, payment_account_number: e.target.value })} autoComplete="off" /></Field>
                <Field label="开户银行" style={{ gridColumn: '1 / -1' }}><input value={form.payment_bank || ''} onChange={e => setForm({ ...form, payment_bank: e.target.value })} placeholder="银行及开户支行" /></Field>
              </>}
            </div>
            <div className="row">
              <Btn onClick={() => setEditing(null)}>取消</Btn>
              <Btn primary onClick={save}>保存</Btn>
            </div>
          </div>
        </Modal>
      )}

      {exp && (
        <Modal onClose={() => setExp(null)}>
          <div className="modal">
            <h3>记录渠道费用 · {exp.channel_name}</h3>
            <div className="grid g2">
              <Field label={exp.channel_type === 'headhunter' ? '关联候选人（必选）' : '关联候选人'} style={{ gridColumn: '1 / -1' }}>
                <select value={exp.candidate_id || ''} onChange={e => pickExpenseCandidate(e.target.value)}>
                  <option value="">— {exp.candidates?.length ? '选择该渠道推荐的人选' : '该渠道暂无关联人选'} —</option>
                  {exp.candidates?.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}（{candidate.requisition_title || '未关联需求'} · {stageLabel(candidate.stage)}）</option>)}
                </select>
              </Field>
              <Field label="月份"><input type="month" value={exp.year_month} onChange={e => setExp({ ...exp, year_month: e.target.value })} /></Field>
              <Field label="金额（元）"><input type="number" value={exp.amount} onChange={e => setExp({ ...exp, amount: e.target.value })} /></Field>
              {exp.candidate_id && exp.suggested !== '' && <Hint style={{ gridColumn: '1 / -1' }}>费用建议：月薪 ¥{Number(exp.salary).toLocaleString('zh-CN')} × {exp.fee_basis_months} 个月 × {exp.fee_rate}% = ¥{Number(exp.suggested).toLocaleString('zh-CN')}；金额仍可手工调整。</Hint>}
              <Field label="备注" style={{ gridColumn: '1 / -1' }}><input value={exp.note} onChange={e => setExp({ ...exp, note: e.target.value })} /></Field>
            </div>
            <div className="row">
              <Btn onClick={() => setExp(null)}>取消</Btn>
              <Btn primary onClick={addExpense}>保存</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
