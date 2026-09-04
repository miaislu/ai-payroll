/** 员工是否可读取某员工的入转调离事件 */
export function canReadEmployeeEvents(user, employeeId) {
  if (!user) return false
  if (canOps(user)) return true
  if (user.role === 'emp' && user.employee_id != null && Number(user.employee_id) === Number(employeeId)) return true
  return false
}

export const HR_ROLES = ['hr', 'founder']
export const FINANCE_ROLES = ['finance', 'founder']
export const OPS_ROLES = ['hr', 'finance', 'founder']
export const MONEY_APPROVAL_TYPES = ['raise', 'option', 'offer']

/** 人事写操作（档案、招聘、考勤录入） */
export function canStaff(user) {
  return Boolean(user && HR_ROLES.includes(user.role))
}
/** 发钱类审批与月结锁定 */
export function canFinance(user) {
  return Boolean(user && FINANCE_ROLES.includes(user.role))
}
/** 看公司侧数据（成本、工资、审批列表） */
export function canOps(user) {
  return Boolean(user && OPS_ROLES.includes(user.role))
}

/** band：HR/CEO；raise/option/offer：财务/CEO。CEO 均可。 */
export function canApprove(user, type) {
  if (!user) return false
  if (user.role === 'founder') return true
  if (type === 'band') return user.role === 'hr'
  if (MONEY_APPROVAL_TYPES.includes(type)) return user.role === 'finance'
  return false
}

export function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    employee_id: user.employee_id ?? null
  }
}
