import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_JOB_CATALOG, mergeJobCatalog } from '../lib/job_catalog.js'

test('private role configuration extends generic defaults without changing public defaults', () => {
  const custom = { tech: { jobs: ['自定义技术岗位'] }, support: { jobs: ['自定义职能岗位'] } }
  const merged = mergeJobCatalog(custom)
  assert.ok(merged.tech.jobs.includes('自定义技术岗位'))
  assert.ok(merged.tech.jobs.includes('数字验证'))
  assert.ok(merged.support.jobs.includes('自定义职能岗位'))
  assert.ok(!DEFAULT_JOB_CATALOG.tech.jobs.includes('自定义技术岗位'))
  assert.throws(() => mergeJobCatalog({ tech: { jobs: [42] } }), /格式不正确/)
  assert.throws(() => mergeJobCatalog(JSON.parse('{"__proto__":{"jobs":["不合法"]}}')), /格式不正确/)
})
