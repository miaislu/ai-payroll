import { Worker } from 'node:worker_threads'
import yauzl from 'yauzl'

// Bound ZIP expansion before passing XLSX data to the parser.
function checkWorkbookZip(buffer) {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return Promise.resolve()
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error)
      let bytes = 0
      let entries = 0
      let workbook = false
      let settled = false
      const fail = error => {
        if (settled) return
        settled = true
        zip.close()
        reject(error)
      }
      zip.on('error', fail)
      zip.on('entry', entry => {
        bytes += entry.uncompressedSize
        entries++
        if (bytes > 32 * 1024 * 1024 || entries > 2000) return fail(new Error('Excel 简历解压内容过大'))
        if (entry.fileName === 'xl/workbook.xml') workbook = true
        zip.readEntry()
      })
      zip.on('end', () => {
        if (settled) return
        settled = true
        if (!workbook) reject(new Error('文件不是有效的 Excel 工作簿'))
        else resolve()
      })
      zip.readEntry()
    })
  })
}

export async function extractExcelText(buffer) {
  await checkWorkbookZip(buffer)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./excel_resume_worker.js', import.meta.url), {
      workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 128 }
    })
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Excel 简历解析超时，请精简工作簿后重试')) }, 10000)
    worker.once('message', result => {
      clearTimeout(timer)
      worker.terminate()
      if (result.error) reject(new Error(result.error))
      else resolve(result.text)
    })
    worker.once('error', error => { clearTimeout(timer); reject(error) })
    worker.once('exit', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error('Excel 简历解析失败或超出资源限制'))
    })
  })
}
