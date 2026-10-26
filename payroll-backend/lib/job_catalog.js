import './env.js'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

export const DEFAULT_JOB_CATALOG = {
  tech: {
    label: '技术',
    jobs: [
      '模拟IC设计', '数字前端(RTL)', '数字验证', '数字后端', '版图设计',
      '工艺工程师(光刻)', '工艺整合PIE', '设备工程师', '器件/TCAD',
      'EDA研发', '芯片测试ATE', '封装(先进封装)', '芯片固件/驱动'
    ]
  },
  mgmt: {
    label: '管理',
    jobs: ['工程管理', '研发管理', '项目管理', '生产管理', '供应链管理', '职能管理']
  },
  support: {
    label: '职能',
    jobs: ['人力资源', '财务', '行政', '法务', '市场', '销售', '采购', '质量体系', '商务', '客户支持']
  }
}

export function mergeJobCatalog(custom = {}) {
  const result = structuredClone(DEFAULT_JOB_CATALOG)
  for (const [key, group] of Object.entries(custom)) {
    if (!['tech', 'mgmt', 'support'].includes(key) || !Array.isArray(group?.jobs) || group.jobs.some(job => typeof job !== 'string' || !job.trim() || job.length > 200)) throw new Error('私有岗位词典格式不正确')
    result[key].jobs = [...new Set([...group.jobs.map(job => job.trim()), ...result[key].jobs])]
  }
  return result
}

// Company-specific roles live with application data, never in the source repository.
const catalogPath = process.env.JOB_CATALOG_FILE || (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'job-catalog.json') : null)
export const JOB_CATALOG = catalogPath && existsSync(catalogPath)
  ? mergeJobCatalog(JSON.parse(readFileSync(catalogPath, 'utf8'))) : mergeJobCatalog()

export const JOB_FAMILIES = Object.values(JOB_CATALOG).flatMap(group => group.jobs)

export function categoryOfJob(jobFamily) {
  return Object.entries(JOB_CATALOG).find(([, group]) => group.jobs.includes(jobFamily))?.[0] || null
}

export function categoryLabel(category) {
  return JOB_CATALOG[category]?.label || '未分类'
}
