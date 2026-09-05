import { useEffect, useState } from 'react'
import { Card, Chip, Hint, Btn, Field, Modal } from '../components/ui.jsx'
import { getChannels, createChannel, updateChannel, deleteChannel, createChannelExpense, deleteChannelExpense, getRecruitingStats } from '../api.js'
import { formatWanInt } from '../lib/format.js'
import { currentPeriod } from '../lib/period.js'
import { useDialog } from '../components/DialogProvider.jsx'

const TYPE_LABEL = { job_board: '招聘平台', headhunter: '猎头', employee_ref: '内推', university: '校园招聘', other: '其他' }

export default function Channels({ toast, backendUp }) {
  const { confirm: askConfirm } = useDialog()
  const [list, setList] = useState(null)
  const [stats, setStats] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', type: 'job_board', contact: '', note: '' })
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
    try {
      await createChannelExpense({ channel_id: exp.channel_id, year_month: exp.year_month || currentPeriod(), amount: +exp.amount, note: exp.note || '' })
      toast('已记录费用'); setExp(null); load()
    } catch { toast('记录失败') }
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
          <Btn primary onClick={() => { setForm({ name: '', type: 'job_board', contact: '', note: '' }); setEditing('new') }}>+ 添加渠道</Btn>
        </div>
        <table>
          <thead><tr><th>渠道</th><th>类型</th><th>联系人</th><th>备注</th><th>费用记录</th><th>操作</th></tr></thead>
          <tbody>
          {list?.map(c => (
            <tr key={c.id}>
              <td><b>{c.name}</b></td>
              <td><Chip kind="info">{TYPE_LABEL[c.type] || c.type}</Chip></td>
              <td>{c.contact || '—'}</td>
              <td className="hint">{c.note || '—'}</td>
              <td>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {c.expenses?.map(e => (
                    <span key={e.year_month} style={{ fontSize: 12 }}>
                      {e.year_month}：{formatWanInt(e.amount)}
                      <span style={{ color: '#dc2626', cursor: 'pointer', marginLeft: 4 }} onClick={() => delExpense(c.id, e.id)}>✕</span>
                    </span>
                  ))}
                  <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setExp({ channel_id: c.id, year_month: currentPeriod(), amount: '', note: '' })}>+ 记费用</button>
                </div>
              </td>
              <td style={{ display: 'flex', gap: 6 }}>
                <Btn sm onClick={() => { setForm({ name: c.name, type: c.type, contact: c.contact, note: c.note }); setEditing(c) }}>编辑</Btn>
                <Btn sm onClick={() => del(c)}>删除</Btn>
              </td>
            </tr>
          ))}
          {list && !list.length && <tr><td colSpan={6}><Hint>暂无渠道</Hint></td></tr>}
          </tbody>
        </table>
      </Card>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div className="modal">
            <h3>{editing === 'new' ? '添加渠道' : '编辑渠道'}</h3>
            <div className="grid g2">
              <Field label="渠道名称"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="类型">
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="联系人"><input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} /></Field>
              <Field label="备注"><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field>
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
            <h3>记录渠道费用</h3>
            <div className="grid g2">
              <Field label="月份"><input type="month" value={exp.year_month} onChange={e => setExp({ ...exp, year_month: e.target.value })} /></Field>
              <Field label="金额（元）"><input type="number" value={exp.amount} onChange={e => setExp({ ...exp, amount: e.target.value })} /></Field>
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
