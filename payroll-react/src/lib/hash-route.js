import { PAGES, ROLE_VIEWS } from '../data.js'

const PAGE_IDS = new Set(Object.keys(PAGES))

export function parseHash(hash = '') {
  const raw = String(hash).replace(/^#/, '')
  const parts = raw.split('/').filter(Boolean)
  const page = parts[0] && PAGE_IDS.has(parts[0]) ? parts[0] : 'dashboard'
  if (page === 'employee-profile') {
    const empId = Number(parts[1])
    return { page, empId: Number.isInteger(empId) && empId > 0 ? empId : null }
  }
  if (['candidates', 'interviews'].includes(page)) {
    const candidateId = Number(parts[1])
    return { page, empId: null, candidateId: Number.isInteger(candidateId) && candidateId > 0 ? candidateId : null }
  }
  return { page, empId: null }
}

export function toHash(page, empId) {
  if (page === 'employee-profile' && empId) return `#/employee-profile/${empId}`
  if (['candidates', 'interviews'].includes(page) && empId) return `#/${page}/${empId}`
  return `#/${page || 'dashboard'}`
}

export function resolvePage(role, page, empId) {
  const views = ROLE_VIEWS[role] || ROLE_VIEWS.founder
  if (page === 'employee-profile') {
    if (views.includes('employee-profile') && empId) return { page: 'employee-profile', empId }
    return { page: views.includes('employees') ? 'employees' : views[0], empId: null }
  }
  const next = views.includes(page) ? page : views[0]
  if (['candidates', 'interviews'].includes(next)) return { page: next, empId: null, candidateId: Number.isInteger(empId) && empId > 0 ? empId : null }
  return { page: next, empId: null }
}
