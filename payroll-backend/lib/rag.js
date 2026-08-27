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
    source: '财税〔2016〕101号 · 政策库 #45',
    text: '非上市公司授予员工的股权激励（含期权/限制性股票），符合条件可递延纳税：行权时不征税，转让时按"财产转让所得" 20% 缴纳。条件：激励计划备案、期权池设立、员工真实行权、持股平台合规、非上市公司等。不符合条件的按工资薪金所得征税。'
  },
  {
    id: 'policy-164', title: '财税〔2018〕164号 · 上市公司股权激励单独计税（延至2027年底）',
    keywords: ['164号', '单独计税', '上市公司', '2027', '行权', '综合所得', '股权激励', '股票期权', '限制性股票'],
    source: '财税〔2018〕164号 · 财政部税务总局公告2023年第25号延续',
    text: '居民个人取得上市公司股权激励（股票期权/限制性股票等），行权收入不并入当年综合所得，全额单独适用综合所得税率表（3%-45%）计算纳税。该政策已延续至 2027 年 12 月 31 日。'
  },
  {
    id: 'policy-35', title: '财税〔2005〕35号 · 非递延情形行权计税',
    keywords: ['35号', '行权', '工资薪金', '累进', '价差'],
    source: '财税〔2005〕35号',
    text: '不符合递延纳税条件的股权激励，员工行权时，行权价与当期公允价值的差额，按"工资薪金所得"适用 3%-45% 超额累进税率计税。'
  },
  {
    id: 'law-44', title: '《劳动法》第44条 · 加班费倍数',
    keywords: ['加班', '加班费', '倍数', '休息日', '法定节假日', '调休', '1.5', '2倍', '3倍'],
    source: '《劳动法》第 44 条',
    text: '加班费：工作日延长工作时间 1.5 倍；休息日安排工作又不能补休的 2 倍；法定休假日安排工作的 3 倍。加班基数 = 基本工资 ÷ 21.75 天。'
  },
  {
    id: 'law-46', title: '《劳动合同法》第46-47条 · 经济补偿与离职结算',
    keywords: ['离职', '结算', '经济补偿', 'N', '年假', '违法解除', '赔偿'],
    source: '《劳动合同法》第 46-47 条 · 离职结算制度 v1.5',
    text: '离职结算 = 当月工资 + 未休年假折算 + 经济补偿。经济补偿 N：每满一年支付一个月工资，六个月以上不满一年按一年计，不满六个月支付半个月；违法解除按 2N。裁员/辞退属于解除劳动合同情形。社保离职当月由公司缴纳，次月起停缴。'
  },
  {
    id: 'tax-2025', title: '2025 个税 · 累计预扣与专项附加扣除',
    keywords: ['个税', '税', '专项附加', '扣除', '累计预扣', '子女教育', '赡养老人', '住房贷款'],
    source: '个人所得税法 · 国家税务总局 2025 年专项附加扣除公告',
    text: '工资薪金个税采用累计预扣法。2025 专项附加扣除：子女教育 2000/月、继续教育 400/月、住房贷款利息 1000/月、住房租金（800-1500/月按城市）、赡养老人 3000/月（独生子女）、3岁以下婴幼儿照护 2000/月。示例：张三（月薪25K，社保公积金3950）个税约 2,310 元。'
  },
  {
    id: 'social-2025', title: '社保公积金 · 按所在城市当年基数执行',
    keywords: ['社保', '基数', '公积金', '缴费', '养老', '医疗', '比例'],
    source: '城市政策参数表（lib/city_policies.js）· 各地人社局年度通告',
    text: '社保公积金按员工所在城市当年基数与比例执行。城市政策参数表已收录：上海 2025 社保基数下限 7460 元/月、合肥 2025 最低基数 4227/公积金 2060；北京（官方通告）、深圳（本地宝汇总）等城市数值待人工录入。个人比例参考：养老 8%、医疗 2%、失业 0.3%；公积金按城市规定 5%-12%。试用期按实际工资申报缴费。'
  },
  {
    id: 'trial-32', title: '薪酬制度 v3.2 · 试用期工资',
    keywords: ['试用期', '转正', '80%', '最低工资'],
    source: '薪酬制度 v3.2 P3',
    text: '试用期工资 ≥ 转正工资的 80%，且不低于当地最低工资标准。试用期社保公积金按实际工资基数缴纳。'
  },
  {
    id: 'band-32', title: '薪酬制度 v3.2 · 带宽与定薪',
    keywords: ['带宽', '定薪', '调薪', 'P50', '分位', '职级'],
    source: '薪酬制度 v3.2 P5-P7 · 对标库（benchmark-data/benchmark-dataset.json）',
    text: '定薪依据岗位带宽（P25/P50/P75，按方向×城市×经验×公司类型），超带宽需创始人审批。调薪建议综合带宽位置、内部公平性与绩效。模拟IC设计（上海 3-5年 Fabless）现金 P50 校准值为 50万/年。'
  },
  {
    id: 'equity-plan', title: '期权激励计划 · 授予与归属条款',
    keywords: ['期权', '授予', '归属', 'cliff', '行权窗口', '加速', '稀释', '回购'],
    source: '期权激励计划 v2.0 · 附录 E',
    text: '期权 4 年归属、1 年 cliff（25%），此后按月/季度归属。离职后行权窗口惯例 90-180 天。并购场景可设单触发/双触发加速归属。行权价通常按最新融资估值 30%-50% 折扣。未来融资会稀释期权价值，模拟时需计入。'
  },
  {
    id: 'talent-subsidy', title: '各地半导体人才补贴政策（知识库 23 条）',
    keywords: ['补贴', '人才', '落户', '购房', '个税返还', '安家费'],
    source: '政策知识库 · 人才补贴类 23 条',
    text: '常见政策：落户（上海/深圳/苏州）、购房补贴（无锡 20-50 万）、个税返还（合肥/成都）、一次性安家费。各城市差异大，需按员工所在城市检索并生成申报材料。'
  },
  {
    id: 'hr-process', title: 'HR 流程口径 · 入转调离与社保变动',
    keywords: ['入职', '转正', '调薪', '离职', '社保变动', '基数调整'],
    source: 'HR 操作手册 v1.8',
    text: '月度算薪自动汇聚入转调离、考勤、绩效与社保变动；发薪前做一致性校验（总额环比、人均带宽、个税倒推）。社保基数调整、转正生效、离职结算会生成差异标记，需 HR 复核。'
  },
  {
    id: 'tax-bonus', title: '全年一次性奖金（年终奖）单独计税 · 财税〔2018〕164号第2条（延至2027）',
    keywords: ['年终奖', '奖金', '全年一次性', '单独计税', '税率表'],
    source: '财税〔2018〕164号 · 财政部税务总局公告2023年第25号延续',
    text: '居民个人取得全年一次性奖金（年终奖），可选择不并入当年综合所得，单独按月换算后的综合所得税率表计算纳税（即"年终奖单独计税"）；该政策已延续至 2027 年 12 月 31 日。也可选择并入综合所得，二者取低者。'
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
