import { Router } from 'express'
import { auth } from '../lib/auth.js'
import { normalizeOptionInput, optionMetrics, optionSensitivity } from '../lib/calc.js'
import { OPS_ROLES } from '../lib/access.js'

export const option = Router()

option.post('/option/simulate', auth(OPS_ROLES), (req, res) => {
  const { inp, taxMode = true } = req.body || {}
  try {
    const normalized = normalizeOptionInput(inp)
    res.json({ metrics: optionMetrics(normalized, Boolean(taxMode)), sensitivity: optionSensitivity(normalized, Boolean(taxMode)) })
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message })
  }
})
