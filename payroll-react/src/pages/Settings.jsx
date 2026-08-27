import { Card, Chip, Hint, Btn } from '../components/ui.jsx'

export default function Settings({ toast }) {
  return (
    <>
      <div className="grid g3">
        <Card title={<>📖 岗位词典 <Chip kind="ok">v1.3</Chip></>}>
          <Hint>规范岗位 24 类 · 同义词 428 条 · 消歧规则 8 条<br />本周 LLM 建议新增 6 条（待审核）</Hint>
          <Btn sm onClick={() => toast('打开词典审核（原型演示）')}>审核新增词条</Btn>
        </Card>
        <Card title={<>🏛️ 政策知识库 <Chip kind="ok">87 条</Chip></>}>
          <Hint>个税 / 社保 / 公积金 / 人才补贴 / 劳动法<br />最后更新：2025-06-15（个税专项附加扣除）</Hint>
          <Btn sm onClick={() => toast('打开政策库（原型演示）')}>管理政策库</Btn>
        </Card>
        <Card title="🛰️ 对标数据源">
          <Hint><span className="status-dot sd-ok" />猎聘 · 正常（今日 +312 条）</Hint>
          <Hint><span className="status-dot sd-ok" />Boss直聘 · 正常（今日 +480 条）</Hint>
          <Hint><span className="status-dot sd-warn" />智联 · 限速中（降级轮询）</Hint>
          <Hint><span className="status-dot sd-bad" />拉勾 · 已停用（对方更新反爬）</Hint>
          <Hint style={{ marginTop: 8 }}>合规开关：收到风险信号自动切换数据源（附录 A.2）</Hint>
        </Card>
      </div>
      <Card title={<>权限与审计 <Chip kind="info">行级权限已启用</Chip></>}>
        <table>
          <tr><th>角色</th><th>可见范围</th><th>关键操作</th></tr>
          <tr><td>创始人</td><td>全部</td><td>审批 · 期权模拟 · 仪表盘</td></tr>
          <tr><td>HR</td><td>薪酬档案（脱敏展示）</td><td>算薪 · 对标 · 申报 · 员工资料</td></tr>
          <tr><td>财务</td><td>工资单汇总 + 复核</td><td>复核 · 代发导出</td></tr>
          <tr><td>员工</td><td>仅本人薪酬单/期权</td><td>问薪 · 申诉</td></tr>
        </table>
        <Hint style={{ marginTop: 8 }}>全部写操作留审计日志；员工端只读本人数据（《个人信息保护法》最小化原则）。</Hint>
      </Card>
    </>
  )
}
