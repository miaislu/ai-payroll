#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
对标数据质量验证脚本（任务 2）
用法: python3 validate_benchmark.py [dataset.json] [output.md]
检查项:
  S1 结构完整性  必填字段、类型
  S2 数值一致性  P25 <= P50 <= P75、正数、年终薪数在 [12,18]
  S3 行业合理性  各方向现金 P50 落在行业合理区间（按方向家族配置）
  S4 来源强度    证据强度(强/中/弱) 与来源数量匹配；URL 格式合法
  S5 覆盖度      与目标方向清单对比，输出缺失方向
  S6 稀缺性排序  稀缺系数与方向家族预期排序一致（EDA>模拟>工艺>数字前端>版图/测试）
输出: markdown 验证报告（每项 pass/warn/fail + 汇总分）
"""
import json, re, sys, datetime, urllib.request, urllib.error
from pathlib import Path

# 目标方向清单（对齐附录 C 岗位体系）
TARGET_DIRECTIONS = [
    "模拟IC设计工程师", "数字IC前端工程师", "数字验证工程师", "数字后端工程师",
    "版图设计工程师", "工艺工程师", "EDA研发工程师", "芯片测试工程师",
    "封装工程师", "器件工程师", "芯片固件/嵌入式"
]

# 行业合理性区间（现金 P50，万元/年，按方向家族；数据来自行业公开报告综合）
PLAUSIBLE = {
    "模拟IC设计工程师": (35, 120), "数字IC前端工程师": (30, 100), "数字验证工程师": (28, 95),
    "数字后端工程师": (32, 105), "版图设计工程师": (22, 70), "工艺工程师": (25, 80),
    "工艺整合PIE": (28, 80), "设备工程师": (22, 75),
    "EDA研发工程师": (35, 130), "芯片测试工程师": (25, 80), "封装工程师": (26, 85),
    "器件工程师": (30, 95), "芯片固件/嵌入式": (24, 80)
}
# 稀缺性家族排序（升序，越靠右越稀缺）
RARITY_ORDER = ["版图设计工程师", "芯片测试工程师", "芯片固件/嵌入式", "数字验证工程师",
                "数字IC前端工程师", "数字后端工程师", "封装工程师", "器件工程师",
                "工艺工程师", "模拟IC设计工程师", "EDA研发工程师"]
STRENGTH_MIN_SOURCES = {"强": 3, "中": 2, "弱": 1}
URL_RE = re.compile(r'^https?://\S+$')
NUMERIC_ANCHOR_RE = re.compile(r'\d+(?:\.\d+)?\s*(?:万|k|K|元|薪|%)')

def check_entry(e, report, i):
    ok = True
    req = ["direction", "experience_band", "city", "cash_p50_wan", "annual_months", "sources", "evidence"]
    for f in req:
        if f not in e or e[f] in (None, ""):
            report.append(f"  - [{i}] S1 FAIL 缺少必填字段: {f}"); ok = False
    if not ok: return False
    p25, p50, p75 = e.get("p25_wan"), e["cash_p50_wan"], e.get("p75_wan")
    if not (p25 is None or 0 < p25 <= p50):
        report.append(f"  - [{i}] S2 FAIL {e['direction']} P25({p25}) 应满足 0 < P25 <= P50({p50})"); ok = False
    if p75 is not None and not (p50 <= p75):
        report.append(f"  - [{i}] S2 FAIL {e['direction']} P75({p75}) 应 >= P50({p50})"); ok = False
    if not 12 <= e["annual_months"] <= 18:
        report.append(f"  - [{i}] S2 WARN {e['direction']} 年终薪数 {e['annual_months']} 超出常见 [12,18]")
    fam = next((k for k in PLAUSIBLE if k in e["direction"]), None)
    if fam:
        lo, hi = PLAUSIBLE[fam]
        if not (lo <= p50 <= hi):
            report.append(f"  - [{i}] S3 WARN {e['direction']} P50={p50} 超出 {fam} 合理区间 [{lo},{hi}]")
    elif "无公开数据" not in str(e.get("notes", "")):
        report.append(f"  - [{i}] S3 WARN 方向 '{e['direction']}' 未配置行业合理区间")
    n_src = len(e["sources"])
    need = STRENGTH_MIN_SOURCES.get(e["evidence"], 1)
    if n_src < need:
        report.append(f"  - [{i}] S4 WARN 证据强度='{e['evidence']}' 但仅 {n_src} 个来源（需 >= {need}）")
    for s in e["sources"]:
        if not URL_RE.match(s.get("url", "")):
            report.append(f"  - [{i}] S4 FAIL 非法 URL: {s.get('url')}"); ok = False
        if not s.get("title") or not s.get("type") or not isinstance(s.get("year"), int):
            report.append(f"  - [{i}] S4 WARN {e['direction']} 来源缺少 title/type/year 元数据")
    anchored = sum(1 for s in e["sources"] if NUMERIC_ANCHOR_RE.search(s.get("title", "")))
    if anchored == 0:
        report.append(f"  - [{i}] S4 WARN {e['direction']} 没有来源标题包含可复核的薪酬数字锚点")
    return ok

def check_urls(entries, report):
    report.append("## 四、来源可访问性抽查（联网）")
    for e in entries:
        for source in e.get("sources", []):
            url = source.get("url", "")
            try:
                req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "ai-payroll-validator/1.0"})
                with urllib.request.urlopen(req, timeout=8) as resp:
                    if resp.status >= 400:
                        report.append(f"- S7 WARN HTTP {resp.status}: {url}")
            except Exception as exc:
                report.append(f"- S7 WARN 无法访问: {url} ({type(exc).__name__})")
    report.append("")

def main():
    base = Path(__file__).resolve().parent
    positional = [x for x in sys.argv[1:] if not x.startswith("--")]
    ds_path = Path(positional[0]) if positional else base / "benchmark-dataset.json"
    out_path = Path(positional[1]) if len(positional) > 1 else base / "validation-report.md"
    check_remote = "--check-urls" in sys.argv
    with open(ds_path, encoding="utf-8") as f:
        data = json.load(f)
    report = [f"# 对标数据质量验证报告", "",
              f"> 生成时间: {datetime.date.today().isoformat()}  ·  数据集: {ds_path}",
              f"> 说明: 数据来源为公开行业报告/白皮书/政府指导价/媒体，仅供内部对标库校准参考，不构成薪酬建议。", ""]
    checks = {"S1结构": 0, "S2数值": 0, "S3合理": 0, "S4来源": 0, "S5覆盖": 0, "S6排序": 0}
    total = warn = fail = 0
    entries = data.get("directions", [])
    report.append(f"## 一、结构完整性（S1/S2）\n共 {len(entries)} 条数据记录")
    for i, e in enumerate(entries):
        if not check_entry(e, report, i):
            fail += 1
    report.append("")
    report.append(f"## 二、覆盖度（S5）")
    have = {e["direction"] for e in entries}
    missing = [d for d in TARGET_DIRECTIONS if not any(d in h for h in have)]
    report.append(f"- 目标方向 {len(TARGET_DIRECTIONS)} 个，已有数据 {len(have)} 个，缺失 {len(missing)} 个")
    for m in missing:
        report.append(f"  - 缺失: {m}（无公开数据 → 建议走贡献-回报网络或第三方报告锚点）")
    report.append("")
    report.append("## 三、稀缺性排序一致性（S6）")
    by_name = {e["direction"]: e for e in entries}
    rank = []
    for d in RARITY_ORDER:
        hit = next((e for e in entries if d in e["direction"]), None)
        if hit: rank.append((d, hit.get("rarity_factor")))
    prev = 0; ok_order = True
    for d, rf in rank:
        flag = "OK" if (rf or 1) >= prev else "WARN"
        if flag == "WARN": ok_order = False
        report.append(f"  - {d}: 稀缺系数 {rf} [{flag}]")
        prev = rf or 1
    report.append("")
    if check_remote:
        check_urls(entries, report)
    report.append(f"## {'五' if check_remote else '四'}、汇总")
    report.append(f"- 数据记录: {len(entries)} 条  ·  失败项: {fail}  ·  警告项: {sum(1 for l in report if 'WARN' in l)}")
    report.append(f"- 结论: {'✅ 结构与区间检查通过；入库前仍须人工核验来源内容、样本口径和数值推导' if fail == 0 else '❌ 存在失败项，需修正后入库'}")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(report))
    print(f"报告已生成: {out_path}")
    print(f"记录 {len(entries)} 条 | FAIL {fail} | WARN {sum(1 for l in report if 'WARN' in l)}")

if __name__ == "__main__":
    main()
