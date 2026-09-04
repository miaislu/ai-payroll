// RAG 检索层：稀疏向量（TF-IDF + 余弦） + 同义词扩展 + 关键词加分 混合检索
// 说明：本地无法下载稠密 embedding 模型（HuggingFace 不可达），采用稀疏向量方案；
//       接口与稠密向量（embedding API）可互换，后续接入后仅需替换 buildDocVector/queryVector。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 语料：政策/制度条目 ──
export const CORPUS = [
  {
    id: 'policy-101', title: '财税〔2016〕101号 · 非上市公司股权激励递延纳税',
    keywords: ['递延', '期权', '101号', '股权激励', '行权', '财产转让', '20%', '持股平台'],
    source: '历史法规索引：财税〔2016〕101号（使用前须核验现行状态）',
    text: '非上市公司股权激励在满足文件规定的适用范围、备案和持有等条件时可能适用递延纳税。具体方案是否符合条件、纳税时点和所得类型必须由税务负责人根据当前有效官方文件确认。'
  },
  {
    id: 'policy-164', title: '财税〔2018〕164号 · 上市公司股权激励单独计税（延至2027年底）',
    keywords: ['164号', '单独计税', '上市公司', '2027', '行权', '综合所得', '股权激励', '股票期权', '限制性股票'],
    source: '历史法规索引：财税〔2018〕164号、财政部税务总局公告2023年第25号',
    text: '历史文件曾规定特定上市公司股权激励的单独计税口径与适用期限。系统不判断交易是否适用；办理前须从财政部、税务总局官方渠道核验当前有效期、适用主体和计算方法。'
  },
  {
    id: 'policy-35', title: '财税〔2005〕35号 · 非递延情形行权计税',
    keywords: ['35号', '行权', '工资薪金', '累进', '价差'],
    source: '历史法规索引：财税〔2005〕35号（使用前须核验现行状态）',
    text: '不符合递延条件的股权激励可能在行权等环节产生纳税义务。所得性质、计税价格和税率取决于激励类型及当前有效规则，应交由税务负责人确认。'
  },
  {
    id: 'law-44', title: '《劳动法》第44条 · 加班费倍数',
    keywords: ['加班', '加班费', '倍数', '休息日', '法定节假日', '调休', '1.5', '2倍', '3倍'],
    source: '《劳动法》第 44 条',
    text: '工作日延长工时、休息日安排工作且不能补休、法定休假日安排工作的工资支付倍数分别为 1.5、2、3。具体加班工资基数还应按有效劳动合同、集体合同及当地规则核验。'
  },
  {
    id: 'law-46', title: '《劳动合同法》第46-47条 · 经济补偿与离职结算',
    keywords: ['离职', '结算', '经济补偿', 'N', '年假', '违法解除', '赔偿'],
    source: '《劳动合同法》第 46-48 条（具体案件须由 HR/法务复核）',
    text: '离职结算可能涉及当月工资、未休年假工资、经济补偿或赔偿。是否支付以及年限和基数取决于解除原因、工作年限、工资水平和证据；系统只按人工确认后录入的补偿金额计税，不自动判断法律责任。'
  },
  {
    id: 'tax-2025', title: '2025 个税 · 累计预扣与专项附加扣除',
    keywords: ['个税', '税', '专项附加', '扣除', '累计预扣', '子女教育', '赡养老人', '住房贷款'],
    source: '个人所得税法 · 国家税务总局 2025 年专项附加扣除公告',
    text: '工资薪金通常采用累计预扣法。此条为 2025 年历史资料索引，具体扣除金额、适用条件与有效期必须按当前纳税年度和个人申报信息核验；系统测算不替代税务申报结果。'
  },
  {
    id: 'social-2025', title: '社保公积金 · 按所在城市当年基数执行',
    keywords: ['社保', '基数', '公积金', '缴费', '养老', '医疗', '比例'],
    source: '城市政策参数表（lib/city_policies.js）· 各地人社局年度通告',
    text: '社保公积金应按员工所在城市和账期使用经核验的逐险种基数与比例。系统内 2025 数据仅为历史预览索引，存在公积金、最低工资和逐险种费率缺口；未核验参数会阻断正式月结，不得直接用于申报或发薪。'
  },
  {
    id: 'trial-32', title: '试用期工资与当地政策核验',
    keywords: ['试用期', '转正', '80%', '最低工资'],
    source: '《劳动合同法》第 20 条；最低工资与参保口径须按当地当期规定核验',
    text: '试用期工资需满足劳动合同法规定的比例与最低工资约束；参保基数和费率应使用员工所在城市、对应账期且经核验的政策参数。'
  },
  {
    id: 'band-32', title: '已导入对标带宽与定薪流程',
    keywords: ['带宽', '定薪', '调薪', 'P50', '分位', '职级'],
    source: '本地已导入对标数据；来源与样本量见具体记录',
    text: '系统可按方向、城市、经验和公司类型筛选已导入样本并生成 P25/P50/P75。超带宽申请进入审批；样本不足或来源不可验证时只展示数据质量提示，不生成行业结论。'
  },
  {
    id: 'equity-plan', title: '期权激励计划 · 授予与归属条款',
    keywords: ['期权', '授予', '归属', 'cliff', '行权窗口', '加速', '稀释', '回购'],
    source: '系统授予台账；法律、税务与估值条款须以经批准的正式计划为准',
    text: '系统按每笔授予实际录入的授予日、归属期、cliff、行权价和公允价值展示及摊销，不内置所谓行业惯例。离职行权窗口、加速归属、回购与稀释条款必须以正式激励计划和协议为准。'
  },
  {
    id: 'talent-subsidy', title: '人才补贴需查询实时官方政策',
    keywords: ['补贴', '人才', '落户', '购房', '个税返还', '安家费'],
    source: '系统未连接实时政务政策库',
    text: '人才补贴的对象、金额、窗口期和材料会随城市、园区及年度变化。本地知识库不能判断当前资格或生成正式申报材料，须查询所在地政府当期官方通知。'
  },
  {
    id: 'hr-process', title: 'HR 流程口径 · 入转调离与社保变动',
    keywords: ['入职', '转正', '调薪', '离职', '社保变动', '基数调整'],
    source: '系统流程说明',
    text: '月度算薪汇聚已录入的入转调离、考勤和薪酬条款；政策缺失、异常标记和离职结算会进入预检。系统不会替代 HR、财务对原始材料和最终申报结果的复核。'
  },
  {
    id: 'tax-bonus', title: '全年一次性奖金（年终奖）单独计税 · 财税〔2018〕164号第2条（延至2027）',
    keywords: ['年终奖', '奖金', '全年一次性', '单独计税', '税率表'],
    source: '历史法规索引：财税〔2018〕164号、财政部税务总局公告2023年第25号',
    text: '历史文件曾规定全年一次性奖金的单独计税选择与适用期限。本系统尚未实现年终奖专项计算；办理时须通过税务机关官方渠道核验当前有效规则，并比较适用方案。'
  }
]

// ── 停用词（中文问答高频噪音，分词后过滤）──
const STOPWORDS = new Set(['公司', '员工', '需要', '什么', '怎么', '多少', '哪些', '哪个', '是否', '可以', '吗', '的', '是', '在', '有', '我', '你', '了', '和', '与', '或', '那', '这个', '一下', '知道', '请问'])

// ── 中文分词：词典词 + 字符二元组 + 同义词归一 ──
const DICT = new Set()
for (const c of CORPUS) for (const kw of c.keywords) DICT.add(kw)
// 同义词组：组内任意词归一为组首词（查询与文档两侧都归一，保证匹配）
const SYNONYM_GROUPS = [
  ['缴存', '缴纳', '缴费', '交纳'],
  ['赔偿', '补偿', '赔付'],
  ['裁员', '辞退', '解雇', '开除', '解除'],
  ['工资', '薪酬', '薪水', '薪资', '待遇'],
  ['住房公积金', '公积金', '住房公基金'],
  ['社保', '社会保险', '五险'],
  ['个税', '个人所得税'],
  ['加班费', '加班工资', '加班'],
  ['股权激励', '期权', '股票期权'],
  ['离职', '辞职', '离岗'],
  ['试用', '试用期']
]
const SYNONYM = new Map()
for (const g of SYNONYM_GROUPS) for (const w of g) SYNONYM.set(w, g[0])
const canon = t => SYNONYM.get(t) || t

function tokenize(text) {
  const t = String(text || '').toLowerCase()
  const terms = new Set()
  // 词典最大匹配（含同义词归一）
  let i = 0
  while (i < t.length) {
    let hit = null
    for (let len = Math.min(6, t.length - i); len >= 2; len--) {
      const w = t.slice(i, i + len)
      if (DICT.has(w)) { hit = w; break }
    }
    if (hit) { terms.add(canon(hit)); i += hit.length } else i++
  }
  // 字符二元组（对未命中部分做 bigram，捕捉新说法）
  const clean = t.replace(/[^\u4e00-\u9fa5a-z0-9]/g, '')
  for (let j = 0; j < clean.length - 1; j++) {
    const bg = clean.slice(j, j + 2)
    if (!/[\u4e00-\u9fa5]/.test(bg[0]) && !/[\u4e00-\u9fa5]/.test(bg[1])) continue // 跳过纯数字/字母边界
    terms.add(canon(bg))
  }
  // 停用词过滤
  return [...terms].filter(t => !STOPWORDS.has(t) && t.length >= 2)
}

// ── TF-IDF 索引（模块加载时构建一次）──
const N = CORPUS.length
const df = new Map()
const docVecs = CORPUS.map(doc => {
  const toks = tokenize(doc.title + ' ' + doc.text)
  const tf = new Map()
  for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1)
  for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1)
  return { doc, tf }
})
const idf = t => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1
const INDEX = docVecs.map(({ doc, tf }) => {
  let mag = 0
  const v = new Map()
  for (const [t, c] of tf) { const w = c * idf(t); v.set(t, w); mag += w * w }
  return { doc, v, mag: Math.sqrt(mag) || 1 }
})

function cosine(queryTerms) {
  // 完整余弦：同时除以文档模长与查询模长（0..1）
  const qm = Math.sqrt(queryTerms.reduce((a, t) => a + idf(t) * idf(t), 0)) || 1
  return INDEX.map(({ doc, v, mag }) => {
    let s = 0
    for (const t of queryTerms) if (v.has(t)) s += idf(t) * v.get(t)
    return { doc, s: s / (mag * qm) }
  })
}

// ── 关键词加分：每个词只取最强信号一次（关键词 3 > 标题 2 > 正文 1），避免重复计分 ──
function keywordScore(doc, terms) {
  let s = 0
  for (const t of terms) {
    if (doc.keywords.some(kw => kw.includes(t) || t.includes(kw) || canon(kw) === t)) s += 3
    else if (doc.title.includes(t)) s += 2
    else if (doc.text.includes(t)) s += 1
  }
  return s
}

// ── 混合检索：关键词命中为主排序（curated 语料的权威证据），余弦为次级排序 ──
export function retrieve(question, k = 4) {
  const qTerms = tokenize(question)
  const ranked = cosine(qTerms)
    .map(x => ({ c: x.doc, s: x.s, cos: x.s, kw: keywordScore(x.doc, qTerms) }))
    .filter(x => x.s > 0 || x.kw > 0)
    .sort((a, b) => (b.kw - a.kw) || (b.s - a.s))
    .slice(0, k)
  const maxKw = Math.max(1, ...ranked.map(x => x.kw))
  return ranked.map(x => ({ c: x.c, s: 0.7 * (x.s * 100) + 0.3 * (x.kw / maxKw * 100), cos: x.cos, kw: x.kw }))
}

export function buildContext(scored) {
  return scored.map((x, i) => `[${i + 1}] ${x.c.title}\n来源：${x.c.source}\n正文：${x.c.text}`).join('\n\n')
}
export function contextSources(scored) {
  return scored.map(x => x.c.source)
}

export const COPILOT_SYSTEM = `你是一家中国半导体创业公司（Fabless，约 50 人）的内部薪酬政策助手。
规则：
1. 只能依据【参考上下文】回答；上下文不足以回答时，明确写"该问题需要 HR 人工确认"，不要自行推断。
2. 回答必须附来源，格式：[来源：xxx]，来源从上下文中取，禁止编造文号。
3. 涉及金额/税率等数字只引用上下文，禁止自行计算或编造；需要计算时给出公式并注明"估算"。
4. 用中文、分点、简洁回答，面向 HR 与员工两类读者都能看懂。
5. 与薪酬/政策/社保/期权/补贴无关的问题，礼貌说明只处理薪酬相关问题。`
