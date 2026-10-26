import { parentPort, workerData } from 'node:worker_threads'
import * as XLSX from 'xlsx'

try {
  // Only cached cell values are read. Formulas, macros and external links are never executed.
  const workbook = XLSX.read(Buffer.from(workerData), {
    type: 'buffer', dense: true, sheetRows: 2000, cellFormula: false, cellHTML: false, bookVBA: false
  })
  if (workbook.SheetNames.length > 20) throw new Error('Excel 简历最多支持 20 个工作表')
  const sections = []
  let cells = 0
  let characters = 0
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (sheet['!fullref']) throw new Error('Excel 简历每个工作表最多支持 2000 行')
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false })
    const lines = []
    for (const row of rows) {
      cells += row.length
      if (cells > 50000) throw new Error('Excel 简历内容过大，请只保留个人简历工作表')
      const line = row.map(value => String(value ?? '').trim()).filter(Boolean).join('\t')
      characters += line.length
      if (characters > 200000) throw new Error('Excel 简历文本超过 20 万字上限')
      if (line) lines.push(line)
    }
    if (lines.length) sections.push(`[工作表：${name}]\n${lines.join('\n')}`)
  }
  parentPort.postMessage({ text: sections.join('\n\n') })
} catch (error) {
  parentPort.postMessage({ error: error.message })
}
