import test from 'node:test'
import assert from 'node:assert/strict'
import { JOB_CATALOG, setJobCatalog, resetJobCatalog, categoryForJob } from '../jobCatalog.js'

test('authenticated role catalogs are applied and cleared on logout', () => {
  const original = structuredClone(JOB_CATALOG)
  try {
    setJobCatalog({ ...original, tech: { jobs: ['自定义技术岗位', ...original.tech.jobs] } })
    assert.equal(categoryForJob('自定义技术岗位'), 'tech')
    assert.ok(JOB_CATALOG.tech.jobs.includes('自定义技术岗位'))
    resetJobCatalog()
    assert.deepEqual(JOB_CATALOG, original)
    assert.throws(() => setJobCatalog({ tech: { jobs: [] } }), /格式不正确/)
  } finally { resetJobCatalog() }
})
