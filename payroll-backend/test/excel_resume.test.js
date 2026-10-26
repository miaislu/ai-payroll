import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { extractText, parseResumeByRules } from '../lib/resume_parser.js'
import { validateResumeFile } from '../lib/uploads.js'

for (const bookType of ['xlsx', 'xls']) {
  test(`${bookType} 简历提取中文、跨工作表内容并进入规则解析`, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'excel-resume-'))
    try {
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ['姓名', '测试人选'], ['性别', '女'], ['技能', 'Python,RTL,Verilog']
      ]), '个人信息')
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ['教育经历', '上海交通大学 本科 微电子 2020'], ['项目', 'RTL 验证和 Python 自动化']
      ]), '教育项目')
      const filename = path.join(dir, `resume.${bookType}`)
      writeFileSync(filename, XLSX.write(workbook, { type: 'buffer', bookType }))
      assert.equal(validateResumeFile({ path: filename, originalname: filename }), true)
      const result = await extractText(filename)
      assert.equal(result.engine, 'excel(sheetjs)', result.error)
      assert.match(result.text, /个人信息/)
      assert.match(result.text, /教育项目/)
      const parsed = parseResumeByRules(result.text)
      assert.equal(parsed.basic.name, '测试人选')
      assert.match(parsed.basic.skills, /Python/)
      assert.ok(parsed.education.some(item => item.school.includes('上海交通大学')))
      const fake = path.join(dir, `fake.${bookType}`)
      writeFileSync(fake, '并非 Excel 文件')
      assert.equal(validateResumeFile({ path: fake, originalname: fake }), false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}
