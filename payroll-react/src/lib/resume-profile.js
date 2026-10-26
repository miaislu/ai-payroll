export function mergeResumeProfile(existing = {}, incoming = {}) {
  const basic = { ...(existing.basic || {}) }
  for (const [key, value] of Object.entries(incoming.basic || {})) {
    if (value != null && value !== '' && !(key === 'mobile' && String(value).includes('*') && basic.mobile && !basic.mobile.includes('*'))) basic[key] = value
  }
  return { basic, education: incoming.education?.length ? incoming.education : existing.education || [],
    work_experience: incoming.work_experience?.length ? incoming.work_experience : existing.work_experience || [] }
}
