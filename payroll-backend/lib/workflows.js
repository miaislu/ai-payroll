const CLAIM_ACTIONS = { submitted: { approve: 'approved', reject: 'rejected' }, approved: { pay: 'paid' } }
const ADVANCE_ACTIONS = { submitted: { approve: 'approved', reject: 'rejected' }, approved: { repay: 'repaid' } }

export const nextClaimStatus = (status, action) => CLAIM_ACTIONS[status]?.[action] || null
export const nextAdvanceStatus = (status, action) => ADVANCE_ACTIONS[status]?.[action] || null

