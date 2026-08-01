#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
PR 评论生成器
============================================================
读取 JSON 测试报告，生成 Markdown 格式的 PR 评论内容

用法:
  python3 pr-comment.py --report test-report.json --output comment.md
  python3 pr-comment.py --report test-report.json   # 输出到 stdout
============================================================
"""

import json
import sys
import argparse
from datetime import datetime


# 评论标记（用于查找/更新已有评论）
COMMENT_MARKER = "<!-- backup-test-pr-comment -->"


def make_html_table(headers: list, rows: list) -> str:
    """生成 GitHub 兼容的 HTML 表格"""
    lines = ['<table>']
    # 表头
    lines.append("  <thead>")
    lines.append("    <tr>")
    for h in headers:
        lines.append(f"      <th>{h}</th>")
    lines.append("    </tr>")
    lines.append("  </thead>")
    # 表体
    lines.append("  <tbody>")
    for row in rows:
        lines.append("    <tr>")
        for cell in row:
            lines.append(f"      <td>{cell}</td>")
        lines.append("    </tr>")
    lines.append("  </tbody>")
    lines.append("</table>")
    return "\n".join(lines)


def generate_comment(report: dict, use_html: bool = False) -> str:
    """根据 JSON 报告生成 Markdown 评论"""

    overall = report.get("overall_status", "UNKNOWN")
    exit_code = report.get("exit_code", -1)
    summary = report.get("summary", {})
    failed_cases = report.get("failed_cases", [])
    cases = report.get("cases", [])
    duration = report.get("duration_sec", 0)
    timestamp = report.get("timestamp", "")
    test_name = report.get("test_name", "测试")
    database = report.get("database", "N/A")

    total = summary.get("total_items", 0)
    passed = summary.get("pass", 0)
    failed = summary.get("fail", 0)
    warned = summary.get("warn", 0)
    rate = summary.get("pass_rate", 0)

    lines = []

    # 评论标记（隐藏，用于查找已有评论）
    lines.append(COMMENT_MARKER)
    lines.append("")

    # 标题
    if overall == "PASS":
        lines.append(f"## ✅ {test_name} — 全部通过\n")
    else:
        lines.append(f"## ❌ {test_name} — 存在失败\n")

    # 汇总信息
    if use_html:
        lines.append(make_html_table(
            ["指标", "值"],
            [
                ["状态", f"<strong>{overall}</strong>"],
                ["测试项", str(total)],
                ["通过", str(passed)],
                ["失败", str(failed)],
                ["警告", str(warned)],
                ["通过率", f"{rate}%"],
                ["耗时", f"{duration:.0f}s"],
                ["数据库", f"<code>{database}</code>"],
                ["时间", timestamp],
            ]
        ))
    else:
        lines.append(f"| 指标 | 值 |")
        lines.append(f"|------|-----|")
        lines.append(f"| 状态 | **{overall}** |")
        lines.append(f"| 测试项 | {total} |")
        lines.append(f"| 通过 | {passed} |")
        lines.append(f"| 失败 | {failed} |")
        lines.append(f"| 警告 | {warned} |")
        lines.append(f"| 通过率 | {rate}% |")
        lines.append(f"| 耗时 | {duration:.0f}s |")
        lines.append(f"| 数据库 | `{database}` |")
        lines.append(f"| 时间 | {timestamp} |")
    lines.append("")

    # 如果有失败项，展示详情
    if failed_cases:
        lines.append("### 🔴 失败项详情\n")
        for fc in failed_cases:
            tc_id = fc.get("tc_id", "?")
            title = fc.get("title", "")
            lines.append(f"**{tc_id}: {title}**\n")
            for item in fc.get("failed_items", []):
                lines.append(f"- ❌ {item.get('message', '')}")
            lines.append("")

    # 各场景结果表格
    if cases:
        lines.append("### 📋 各场景结果\n")
        if use_html:
            html_rows = []
            for c in cases:
                tc_id = c.get("tc_id", "")
                title = c.get("title", "")
                status = c.get("status", "")
                p = c.get("pass", 0)
                f = c.get("fail", 0)
                w = c.get("warn", 0)
                icon = {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️"}.get(status, "❓")
                html_rows.append([tc_id, title, f"{icon} {status}", str(p), str(f), str(w)])
            lines.append(make_html_table(
                ["场景", "描述", "状态", "通过", "失败", "警告"],
                html_rows
            ))
        else:
            lines.append(f"| 场景 | 描述 | 状态 | 通过 | 失败 | 警告 |")
            lines.append(f"|------|------|------|------|------|------|")
            for c in cases:
                tc_id = c.get("tc_id", "")
                title = c.get("title", "")
                status = c.get("status", "")
                p = c.get("pass", 0)
                f = c.get("fail", 0)
                w = c.get("warn", 0)
                icon = {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️"}.get(status, "❓")
                lines.append(f"| {tc_id} | {title} | {icon} {status} | {p} | {f} | {w} |")
        lines.append("")

    # 耗时数据
    timing_items = []
    for c in cases:
        for item in c.get("items", []):
            if item.get("timing"):
                timing_items.append((c.get("tc_id", ""), item))

    if timing_items:
        lines.append("### ⏱️ 耗时数据\n")
        if use_html:
            html_timing_rows = [
                [tc_id, item.get("message", "")[:50], f"<code>{item.get('timing', '')}</code>"]
                for tc_id, item in timing_items
            ]
            lines.append(make_html_table(
                ["场景", "测试项", "耗时"],
                html_timing_rows
            ))
        else:
            lines.append(f"| 场景 | 测试项 | 耗时 |")
            lines.append(f"|------|--------|------|")
            for tc_id, item in timing_items:
                lines.append(
                    f"| {tc_id} | {item.get('message', '')[:50]} | `{item.get('timing', '')}` |"
                )
        lines.append("")

    # 底部信息
    lines.append("---")
    lines.append(
        f"📁 详细报告: [test-report.json]  |  "
        f"🤖 由 GitHub Actions 自动生成  |  "
        f"🔄 每次推送自动更新"
    )

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="PR 评论生成器")
    parser.add_argument(
        "--report", "-r",
        required=True,
        help="JSON 测试报告文件路径",
    )
    parser.add_argument(
        "--output", "-o",
        help="输出文件路径 (默认输出到 stdout)",
    )
    parser.add_argument(
        "--html",
        action="store_true",
        help="使用 HTML 表格替代 Markdown 表格 (GitHub PR 渲染更美观)",
    )
    args = parser.parse_args()

    # 读取 JSON 报告
    try:
        with open(args.report, "r", encoding="utf-8-sig") as f:
            report = json.load(f)
    except FileNotFoundError:
        print(f"错误: 报告文件不存在: {args.report}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"错误: JSON 解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    # 生成评论
    comment = generate_comment(report, use_html=args.html)

    # 输出
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(comment)
        print(f"评论已保存到: {args.output}", file=sys.stderr)
    else:
        print(comment)


if __name__ == "__main__":
    main()
