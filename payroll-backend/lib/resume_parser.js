// 简历解析引擎：文本提取（txt/md/docx/pdf）+ 默认本地规则；外部 LLM 必须双重显式授权
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { chat, llmConfigured, LLM_MODEL } from './llm.js'
import { redactForExternalLlm } from './pii.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 文本提取 ──
const TEXT_EXT = ['.txt', '.md', '.text', '.csv', '.json', '.log']
export async function extractText(filePath, contentType = '', filename = '') {
  const ext = path.extname(filename || filePath).toLowerCase()
  let buf
  try {
    buf = readFileSync(filePath)
  } catch (e) {
    return { text: '', engine: null, error: '文件读取失败：' + e.message }
  }
  try {
    if (TEXT_EXT.includes(ext) || (contentType || '').startsWith('text/')) {
      return { text: buf.toString('utf-8'), engine: 'text' }
    }
    if (ext === '.docx' || (contentType || '').includes('wordprocessingml')) {
      const r = await mammoth.extractRawText({ buffer: buf })
      return { text: r.value, engine: 'docx(mammoth)' }
    }
    if (ext === '.pdf' || (contentType || '').includes('pdf')) {
      const parser = new PDFParse({ data: buf })
      const r = await parser.getText()
      return { text: r.text || '', engine: 'pdf(pdf-parse)' }
    }
    return { text: '', engine: null, unsupported: true }
  } catch (e) {
    return { text: '', engine: null, error: e.message }
  }
}

// ── 岗位族推断（技能/关键词 → 半导体岗位族，与 DIRECTIONS 对齐）──
const JOB_FAMILY_RULES = [
  { family: '模拟IC设计', kw: ['模拟', 'SerDes', 'ADC', 'DAC', 'PLL', 'LDO', '电源', 'BCD', 'bandgap', '运放', '放大器', 'buck', 'boost', 'charge pump', '模拟电路'] },
  { family: '数字前端(RTL)', kw: ['RTL', 'Verilog', '逻辑设计', '低功耗', '综合', 'SoC集成', '前端', 'clock gating', 'Lint', 'DFT插入'] },
  { family: '数字验证', kw: ['UVM', 'SystemVerilog', '验证', '覆盖率', 'assertion', 'testbench', 'regression', 'VCS'] },
  { family: '数字后端', kw: ['后端', 'P&R', '时序收敛', '布局布线', '物理设计', 'CTS', 'IR drop', 'ECO', 'STA'] },
  { family: '版图设计', kw: ['版图', 'layout', 'Virtuoso', '物理验证', 'DRC', 'LVS', 'Calibre'] },
  { family: '工艺工程师(光刻)', kw: ['光刻', '工艺', '薄膜', '刻蚀', '扩散', 'CMP', '晶圆', 'Litho', 'etch', 'deposition'] },
  { family: '工艺整合PIE', kw: ['PIE', '工艺整合', '良率', 'yield', 'process integration'] },
  { family: '设备工程师', kw: ['设备', '机台', '维护保养', 'PM', 'uptime', 'equipment'] },
  { family: 'EDA研发', kw: ['EDA', 'PDK', '时序分析', '静态时序', 'STA工具', '编译器', '仿真器', 'Calibre脚本'] },
  { family: '芯片测试ATE', kw: ['ATE', '测试程序', '测试开发', 'labview', '测试方案', '探针台', 'handler', '测试机'] },
  { family: '封装(先进封装)', kw: ['封装', '先进封装', 'bump', '2.5D', '3DIC', 'fan-out', 'chiplet', 'wire bond'] },
  { family: '器件/TCAD', kw: ['TCAD', '器件仿真', 'Sentaurus', 'Silvaco', '器件建模', 'characterization'] },
  { family: '芯片固件/驱动', kw: ['固件', '驱动', '嵌入式', 'bootloader', '内核', 'DDR驱动', 'Linux驱动'] }
]
export function inferJobFamily(text) {
  const lower = (text || '').toLowerCase()
  let best = null, bestScore = 0
  for (const r of JOB_FAMILY_RULES) {
    let s = 0
    for (const k of r.kw) if (lower.includes(k.toLowerCase())) s++
    if (s > bestScore) { bestScore = s; best = r.family }
  }
  return { job_family: best, score: bestScore }
}

// 经验年数：工作经历各段时长累加（end 为空视为至今）
export function calcExperienceYears(work) {
  const now = new Date()
  let total = 0
  for (const w of work || []) {
    if (!w.start_date) continue
    const s = new Date(w.start_date + '-01')
    const e = w.end_date ? new Date(w.end_date + '-01') : now
    if (isNaN(s) || isNaN(e) || e < s) continue
    total += (e - s) / (365.25 * 24 * 3600 * 1000)
  }
  return total ? Math.max(0, Math.round(total * 10) / 10) : null
}

// 附加上下文标签：岗位族 + 经验年数（规则与 LLM 路径共用；rawText 可选，优先用于岗位族推断）
export function enrichParsed(parsed, rawText = '') {
  const structured = [parsed.basic?.skills, ...(parsed.education || []).map(e => e.major || e.school || ''), ...(parsed.work_experience || []).map(w => w.company + ' ' + (w.title || '') + ' ' + (w.note || ''))].join(' ')
  const text = rawText || structured
  const { job_family, score } = inferJobFamily(text)
  const tags = []
  if (job_family && score > 0) tags.push(job_family)
  if ((parsed.education || []).some(e => e.qualification === '博士')) tags.push('博士')
  else if ((parsed.education || []).some(e => e.qualification === '硕士')) tags.push('硕士')
  return {
    ...parsed,
    tags,
    job_family: job_family && score > 0 ? job_family : null,
    experience_years: calcExperienceYears(parsed.work_experience)
  }
}

// 规则解析（LLM 未配置时的降级；中文简历常见结构启发式）──
const PHONE_RE = /1[3-9]\d{9}/
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const SCHOOL_RE = /[\u4e00-\u9fa5]{2,12}(?:大学|学院|学校|研究院|科学院|高等专科学校)/
const DEGREES = ['博士', '硕士', '本科', '大专', '中专']
const SKILL_KEYWORDS = ['Verilog', 'SystemVerilog', 'RTL', '模拟IC', '数字IC', 'SerDes', 'ADC', 'DAC', 'PLL', 'LDO', 'Python', 'C++', 'C语言', 'Matlab', 'PCB', 'FPGA', 'Linux', 'Perl', 'TCL', 'SPICE', 'Cadence', 'Virtuoso', 'Linux', 'UVM', 'SoC', 'HBM', 'DDR', 'PCIe', 'USB', 'JTAG', 'ATE', 'labview']
const MAJOR_RE = /(微电子|集成电路|电子科学与技术|电子信息工程|电子与通信工程|通信工程|计算机科学|计算机技术|软件工程|自动化|材料科学|物理|电气工程|信息工程|机械)/

export function parseResumeByRules(text) {
  const t = text.replace(/\r/g, '').trim()
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean)
  const basic = {}
  const edu = []
  const work = []

  // 姓名：姓名标注优先，其次首行（非纯数字/符号行）
  const nameMark = t.match(/姓名\s*[:：]?\s*([\u4e00-\u9fa5·]{2,6})/)
  if (nameMark) basic.name = nameMark[1]
  else {
    const first = lines.find(l => /^[\u4e00-\u9fa5·]{2,6}$/.test(l))
    if (first) basic.name = first
  }
  const g = t.match(/性别\s*[:：]?\s*(男|女)/)
  if (g) basic.gender = g[1]
  const ph = t.match(PHONE_RE)
  if (ph) basic.mobile = ph[0].slice(0, 3) + '****' + ph[0].slice(7)
  const em = t.match(EMAIL_RE)
  if (em) basic.personal_email = em[0]
  const bd = t.match(/出生(?:日期|年月|时间)?\s*[:：]?\s*(\d{4})[年./-](\d{1,2})[月./-]?(\d{1,2})?/)
  if (bd) basic.date_of_birth = `${bd[1]}-${bd[2].padStart(2, '0')}-${(bd[3] || '01').padStart(2, '0')}`
  const ms = t.match(/婚姻(?:状况)?\s*[:：]?\s*(已婚|未婚)/)
  if (ms) basic.marital_status = ms[1]
  const nl = t.match(/民族\s*[:：]?\s*([\u4e00-\u9fa5]{1,6})/)
  if (nl) basic.nationality = nl[1]
  const addr = t.match(/(?:现居|现住|居住地|现居住地|地址)\s*[:：]?\s*([\u4e00-\u9fa5省市区县路号栋单元\d\s]+)/)
  if (addr) basic.current_address = addr[1].trim()
  const deg = t.match(new RegExp(DEGREES.join('|')))
  if (deg) basic.education_level = deg[0]

  // 教育经历：扫描含学校的行
  for (const line of lines) {
    const s = line.match(SCHOOL_RE)
    if (!s) continue
    const row = { school: s[0] }
    const d = line.match(new RegExp(DEGREES.join('|')))
    if (d) row.qualification = d[0]
    const mj = line.match(MAJOR_RE)
    if (mj) row.major = mj[1]
    const yr = line.match(/(19|20)\d{2}/)
    if (yr) row.graduation_year = Number(yr[0])
    if (!edu.some(x => x.school === row.school)) edu.push(row)
  }

  // 工作经历：工作头行 = 含时间戳 + 公司词；职责描述行并入上一段的 note
  const WORK_RE = /[\u4e00-\u9fa5A-Za-z]{2,20}(?:公司|集团|科技|半导体|设计|fab|foundry|design)/
  const TITLE_RE = /(?:高级|资深|主任|首席)?[\u4e00-\u9fa5A-Za-z]{1,10}(?:工程师|经理|总监|专家|主管|研究员|设计师)/
  const EDU_LINE = /大学|学院|学校|研究院|科学院|硕士|博士|本科/
  const SECTION_RE = /^(专业技能|技能|教育经历|工作经历|项目经历|项目经验|荣誉|自我评价|联系方式|基本信息|个人资料)/
  let lastWork = null
  for (const line of lines) {
    if (EDU_LINE.test(line) && !line.includes('公司')) continue
    const hasTime = /(19|20)\d{2}/.test(line)
    const c = line.match(WORK_RE)
    if (hasTime && c) {
      const row = { company: c[0] }
      const tl = line.match(TITLE_RE)
      if (tl) row.title = tl[0]
      const range = line.match(/((?:19|20)\d{2})[年./-]?(\d{0,2})\s*[-~至]\s*((?:19|20)\d{2})[年./-]?(\d{0,2})|((?:19|20)\d{2})[年./-]?(\d{0,2})?\s*[-~至]?\s*(?:至今|现在)/)
      if (range) row.start_date = range[1] ? `${range[1]}-${(range[2] || '01').padStart(2, '0')}` : `${range[5]}-${(range[6] || '01').padStart(2, '0')}`
      if (range && range[3]) row.end_date = `${range[3]}-${(range[4] || '01').padStart(2, '0')}`
      if (!work.some(x => x.company === row.company)) { work.push(row); lastWork = row }
    } else if (lastWork && !SECTION_RE.test(line) && line.length > 6 && !/^[\w\s,.·/-]{3,60}$/.test(line.trim())) {
      // 职责/项目描述行 → 并入上一段工作经历（保留 P&R/CTS 等技能词供推断；纯技能列表行跳过）
      lastWork.note = (lastWork.note ? lastWork.note + ' ' : '') + line
    }
  }

  // 技能
  const skills = SKILL_KEYWORDS.filter(k => t.includes(k))
  if (skills.length) basic.skills = skills.join(',')

  return { basic, education: edu, work_experience: work, engine: 'rules' }
}

// ── AI 解析（双重显式授权后使用外部 LLM，否则使用本地规则）──
const PARSE_PROMPT = `你是资深 HR 简历解析器。请从下面的中文简历中提取结构化 JSON，只输出 JSON（不要 markdown 代码块、不要解释）：
{
  "basic": { "name","gender","date_of_birth"(YYYY-MM-DD),"marital_status","nationality","education_level","mobile"(脱敏 138****1234),"personal_email","current_address","skills"(逗号分隔) },
  "education": [ { "school","qualification","major","graduation_year","note" } ],
  "work_experience": [ { "company","title","start_date"(YYYY-MM),"end_date"(YYYY-MM 或空), "note" } ]
}
缺失的字段用空值；时间尽量规范为 YYYY-MM-DD / YYYY-MM；技能合并为逗号字符串。
简历内容：
"""
{TEXT}
"""`

function redactResume(text, localBasic) {
  let redacted = redactForExternalLlm(text).text
  for (const [key, value] of Object.entries(localBasic || {})) {
    if (!value || key === 'skills' || key === 'education_level') continue
    const literal = String(value).trim()
    if (literal.length < 2) continue
    redacted = redacted.split(literal).join(`[已脱敏:${key}]`)
  }
  return redacted
}

export async function parseResume(text, { allowExternal = false, onExternal = null } = {}) {
  const truncated = text.slice(0, 6000)
  const externalEnabled = process.env.RESUME_EXTERNAL_LLM === 'true' && llmConfigured()
  if (externalEnabled && allowExternal) {
    try {
      const local = parseResumeByRules(truncated)
      const redacted = redactResume(truncated, local.basic)
      onExternal?.({ model: LLM_MODEL, source_length: truncated.length, redacted_length: redacted.length })
      const raw = await chat([
        { role: 'system', content: '你是精确的 JSON 输出器。' },
        { role: 'user', content: PARSE_PROMPT.replace('{TEXT}', redacted) }
      ], { maxTokens: 1200, temperature: 0.1 })
      const json = raw.replace(/```json|```/g, '').trim()
      const m = json.match(/\{[\s\S]*\}/)
      if (m) {
        const parsed = JSON.parse(m[0])
        const localPii = Object.fromEntries(Object.entries(local.basic || {}).filter(([k]) => ['name', 'gender', 'date_of_birth', 'marital_status', 'nationality', 'mobile', 'personal_email', 'current_address'].includes(k)))
        parsed.basic = { ...(parsed.basic || {}), ...localPii }
        return { ...enrichParsed(parsed, truncated), engine: 'llm', model: LLM_MODEL }
      }
    } catch (e) {
      console.warn('[resume] LLM 解析失败，降级规则:', e.message)
    }
  }
  return { ...enrichParsed(parseResumeByRules(truncated), truncated), engine: allowExternal && externalEnabled ? 'rules-fallback' : 'rules-local' }
}

// 解析结果 → 应用档案字段映射（与 routes/employee.js 白名单一致）
export const RESUME_APPLY_MAP = {
  basic: ['name', 'gender', 'date_of_birth', 'marital_status', 'nationality', 'education_level', 'mobile', 'personal_email', 'current_address', 'skills'],
  education: ['school', 'qualification', 'major', 'graduation_year', 'note'],
  work_experience: ['company', 'title', 'start_date', 'end_date', 'note']
}
