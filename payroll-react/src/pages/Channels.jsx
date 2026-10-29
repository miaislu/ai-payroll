import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getChannels, createChannel, updateChannel, deleteChannel, createChannelExpense, deleteChannelExpense, getRecruitingStats } from '../api.js'
import { formatYuan } from '../lib/format.js'
import { currentPeriod } from '../lib/period.js'
import { useDialog } from '../components/DialogProvider.jsx'
import { CANDIDATE_STAGES } from '../data.js'
import { exactExpectedSalary, expectedAnnualSalaryLabel } from '../lib/candidate-salary.js'

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

export default function Channels({ toast, backendUp, goto }) {
  const { confirm: askConfirm } = useDialog()
  const [list, setList] = useState(null)
  const [stats, setStats] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_CHANNEL)
  const [detailId, setDetailId] = useState(null)
  const detail = list?.find(channel => channel.id === detailId)
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
    } catch (error) { toast('保存失败：' + error.message) }
  }
  const del = async c => {
    if (!await askConfirm({ title: '删除招聘渠道', message: `将删除渠道“${c.name}”及其费用记录。`, confirmLabel: '删除' })) return
    try { await deleteChannel(c.id); toast('已删除'); load() } catch (error) { toast('删除失败：' + error.message) }
  }
  const addExpense = async () => {
    if (!exp.amount) return toast('填写金额')
    if (exp.channel_type === 'headhunter' && !exp.candidate_id) return toast('猎头费用必须选择关联候选人')
    try {
      await createChannelExpense({ channel_id: exp.channel_id, candidate_id: exp.candidate_id || null, year_month: exp.year_month || currentPeriod(), amount: +exp.amount, note: exp.note || '' })
      toast('已记录费用'); setExp(null); load()
    } catch (error) { toast('记录失败：' + error.message) }
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
    try { await deleteChannelExpense(eid); toast('已删除'); load() } catch (error) { toast('删除失败：' + error.message) }
  }

  return (
    <>
      <div className="grid g4">
        <Card className="kpi" style={{ margin: 0 }}><div className="label">累计渠道费用</div><div className="num">{stats ? formatYuan(stats.totalCost) : '—'}</div></Card>
        <Card className="kpi" style={{ margin: 0 }}><div className="label">人均招聘成本</div><div className="num" style={{ color: '#d97706' }}>{stats ? formatYuan(stats.costPerHire) : '—'}</div><div className="sub">累计费用 ÷ 入职人数</div></Card>
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
        <table>
          <thead><tr><th>渠道</th><th>类型</th><th>联系人</th><th>推荐人数</th><th>累计费用</th><th>操作</th></tr></thead>
          <tbody>
          {list?.map(c => (
            <tr key={c.id}>
              <td><b>{c.name}</b></td>
              <td><Chip kind="info">{TYPE_LABEL[c.type] || c.type}</Chip></td>
              <td>{c.contact || '—'}</td>
              <td><Btn sm aria-label={`查看${c.name}推荐名单，${c.candidate_count ?? c.candidates?.length ?? 0}人`} onClick={() => setDetailId(c.id)}>{c.candidate_count ?? c.candidates?.length ?? 0}人</Btn></td>
              <td>¥{Number(c.total_cost ?? (c.expenses || []).reduce((sum, item) => sum + Number(item.amount || 0), 0)).toLocaleString('zh-CN')}</td>
              <td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Btn sm onClick={() => setDetailId(c.id)}>查看详情</Btn>
                <Btn sm onClick={() => { setForm({ ...EMPTY_CHANNEL, ...c }); setEditing(c) }}>编辑</Btn>
                <Btn sm onClick={() => del(c)}>删除</Btn>
              </div></td>
            </tr>
          ))}
          {list && !list.length && <tr><td colSpan={6}><Hint>暂无渠道</Hint></td></tr>}
          </tbody>
        </table>
        </div>
      </Card>

      {detail && (
        <Modal onClose={() => setDetailId(null)}>
          <div className="modal" style={{ width: 900, maxHeight: '86vh', overflowY: 'auto' }}>
            <h3>{detail.name} · 渠道详情 <Chip kind="info">{TYPE_LABEL[detail.type] || detail.type}</Chip></h3>
            <div className="grid g2" style={{ fontSize: 13, marginBottom: 16 }}>
              <div><span className="hint">推荐人数</span><br /><b>{detail.candidate_count ?? detail.candidates?.length ?? 0}人</b></div>
              <div><span className="hint">累计费用</span><br /><b>¥{Number(detail.total_cost || 0).toLocaleString('zh-CN')}</b></div>
              <div><span className="hint">联系人</span><br />{detail.contact || '—'}</div>
              <div><span className="hint">联系方式</span><br />{detail.contact_info || '—'}</div>
              {detail.type === 'headhunter' && <>
                <div><span className="hint">收费标准</span><br />{detail.fee_basis_months ? `${detail.fee_basis_months}个月月薪` : '未设置'}{detail.fee_rate != null ? ` × ${detail.fee_rate}%` : ''}；保证期{detail.guarantee_months != null ? `${detail.guarantee_months}个月` : '未设置'}</div>
                <div><span className="hint">付款信息</span><br />{detail.payment_account_name || '—'} · {detail.payment_bank || '—'}{detail.payment_account_number && <div>账号 {maskAccount(detail.payment_account_number)}</div>}</div>
              </>}
              <div style={{ gridColumn: '1 / -1' }}><span className="hint">备注</span><br />{detail.note || '—'}</div>
            </div>
            <h4>推荐人选名单（{detail.candidate_count ?? detail.candidates?.length ?? 0}人）</h4>
            <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
              <table><thead><tr><th>姓名</th><th>应聘岗位</th><th>当前状态</th><th>期望年薪</th><th>建档日期</th><th>操作</th></tr></thead><tbody>
                {detail.candidates?.map(candidate => <tr key={candidate.id}>
                  <td><b>{candidate.name}</b></td><td>{candidate.requisition_title || '未关联需求'}</td>
                  <td>{stageLabel(candidate.stage)}</td><td>{expectedAnnualSalaryLabel(candidate)}</td><td>{candidate.apply_date || '—'}</td>
                  <td><Btn sm onClick={() => { setDetailId(null); goto('candidates', candidate.id) }}>查看档案</Btn></td>
                </tr>)}
                {!detail.candidates?.length && <tr><td colSpan={6}><Hint>暂无推荐人选</Hint></td></tr>}
              </tbody></table>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
              <h4>费用明细（{detail.expenses?.length || 0}笔）</h4>
              <Btn sm onClick={() => setExp({ channel_id: detail.id, channel_name: detail.name, channel_type: detail.type, candidates: detail.candidates || [], fee_basis_months: detail.fee_basis_months, fee_rate: detail.fee_rate, year_month: currentPeriod(), candidate_id: null, amount: '', note: '' })}>+ 记费用</Btn>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 240, overflowY: 'auto' }}>
              <table><thead><tr><th>月份</th><th>金额</th><th>关联人选</th><th>备注</th><th>操作</th></tr></thead><tbody>
                {detail.expenses?.map(item => <tr key={item.id}><td>{item.year_month}</td><td>¥{Number(item.amount || 0).toLocaleString('zh-CN')}</td><td>{item.candidate_name || '—'}</td><td>{item.note || '—'}</td><td><Btn sm onClick={() => delExpense(detail.id, item.id)}>删除费用</Btn></td></tr>)}
                {!detail.expenses?.length && <tr><td colSpan={5}><Hint>暂无费用记录</Hint></td></tr>}
              </tbody></table>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}><Btn onClick={() => setDetailId(null)}>关闭</Btn></div>
          </div>
        </Modal>
      )}

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
