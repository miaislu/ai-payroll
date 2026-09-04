// 极小的 .env 加载器，必须在 db.js 读取 DB_PATH 前执行。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
try {
  const envPath = path.join(here, '..', '.env')
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match || match[1] in process.env) continue
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
} catch { /* 无 .env 文件则仅使用进程环境变量 */ }
