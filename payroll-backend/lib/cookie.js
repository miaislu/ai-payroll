export const SESSION_COOKIE = 'payroll_session'
export const SESSION_MAX_AGE_SEC = 12 * 60 * 60

export function parseCookieHeader(header, name = SESSION_COOKIE) {
  if (!header) return ''
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    if (key !== name) continue
    try { return decodeURIComponent(part.slice(idx + 1).trim()) } catch { return part.slice(idx + 1).trim() }
  }
  return ''
}

export function tokenFromRequest(req) {
  return parseCookieHeader(req?.headers?.cookie)
}

export function cookieSecure(req) {
  if (process.env.COOKIE_SECURE === '0') return false
  if (process.env.COOKIE_SECURE === '1') return true
  return process.env.NODE_ENV === 'production' || req?.secure === true
}

function cookieParts(value, { maxAgeSec, secure }) {
  const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function sessionCookieHeader(token, req) {
  return cookieParts(encodeURIComponent(token), { maxAgeSec: SESSION_MAX_AGE_SEC, secure: cookieSecure(req) })
}

export function clearSessionCookieHeader(req) {
  return cookieParts('', { maxAgeSec: 0, secure: cookieSecure(req) })
}
