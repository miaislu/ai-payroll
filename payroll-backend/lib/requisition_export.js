import { categoryLabel } from './job_catalog.js'

const text = value => String(value || '').trim() || '待补充'
const employmentLabel = value => ({ employee: '正式员工', consultant: '顾问', intern: '实习生' }[value] || '正式员工')
const money = value => Number(value) > 0 ? `¥${Number(value).toLocaleString('zh-CN')}` : '面议'
const headcount = row => Number(row.headcount) > 0
  ? `${Number(row.headcount)} 人${Number(row.headcount_max) > Number(row.headcount) ? `（弹性上限 ${Number(row.headcount_max)} 人）` : ''}`
  : '待定'

export function formatRequisitionPosting(row) {
  const range = row.salary_min || row.salary_max
    ? `${money(row.salary_min)} - ${money(row.salary_max)} / 月`
    : '面议'
  return [
    '招聘岗位信息',
    '',
    `职位名称：${text(row.title)}`,
    `岗位类别：${categoryLabel(row.job_category)} / ${text(row.job_family)}`,
    row.team_label ? `团队方向：${row.team_label}` : '',
    `工作地点：${text(row.city)}`,
    `招聘人数：${headcount(row)}`,
    `优先级：${text(row.priority)}`,
    `用工类型：${employmentLabel(row.employment_type)}`,
    `薪资范围：${range}`,
    `全年固定薪资：${Number(row.fixed_salary_months) || 12} 个月`,
    `年终奖约定：${Number(row.annual_bonus_months) || 0} 个月`,
    row.target_timing ? `建议到岗时间：${row.target_timing}` : (row.target_month ? `预计到岗：${row.target_month}` : ''),
    '',
    '岗位职责',
    text(row.responsibilities),
    '',
    '任职要求',
    text(row.requirements),
    '',
    `学历要求：${text(row.education_requirement)}`,
    `经验要求：${text(row.experience_requirement)}`,
    `关键技能：${text(row.skills)}`,
    '',
    '岗位背景',
    text(row.reason)
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n').trim() + '\n'
}
