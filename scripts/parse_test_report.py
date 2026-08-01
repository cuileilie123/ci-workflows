#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
备份恢复测试报告解析器
============================================================
自动执行 Docker 测试脚本，解析输出并提取:
  - 各测试场景 (TC-01 ~ TC-10) 的执行结果
  - 每个测试项的 PASS/FAIL/WARN 状态
  - 关键耗时数据 (Cron 触发等待、备份/恢复耗时等)
  - 汇总统计 (总数/通过/失败/通过率)

用法:
  python parse_test_report.py              # 执行测试并解析
  python parse_test_report.py --file log.txt   # 从日志文件解析
  python parse_test_report.py --json       # 输出 JSON 格式
============================================================
"""

import re
import json
import subprocess
import sys
import os
from datetime import datetime, timedelta
from dataclasses import dataclass, field, asdict
from typing import List, Optional


# ---------- 数据模型 ----------

@dataclass
class TestItem:
    """单个测试项"""
    status: str          # PASS / FAIL / WARN
    message: str         # 描述信息
    timing: Optional[str] = None  # 耗时信息 (如有)


@dataclass
class TestCase:
    """测试场景 (TC-XX)"""
    tc_id: str           # TC-01
    title: str           # 场景标题
    items: List[TestItem] = field(default_factory=list)

    @property
    def pass_count(self) -> int:
        return sum(1 for i in self.items if i.status == "PASS")

    @property
    def fail_count(self) -> int:
        return sum(1 for i in self.items if i.status == "FAIL")

    @property
    def warn_count(self) -> int:
        return sum(1 for i in self.items if i.status == "WARN")

    @property
    def status(self) -> str:
        if self.fail_count > 0:
            return "FAIL"
        if self.warn_count > 0:
            return "WARN"
        return "PASS"


@dataclass
class TestReport:
    """完整测试报告"""
    test_name: str
    executed_at: str
    database: str
    total_cases: int = 0
    total_items: int = 0
    pass_count: int = 0
    fail_count: int = 0
    warn_count: int = 0
    pass_rate: float = 0.0
    duration_sec: float = 0.0
    cases: List[TestCase] = field(default_factory=list)
    raw_output: str = ""

    @property
    def overall_status(self) -> str:
        """CI/CD 判断用：PASS 或 FAIL"""
        return "PASS" if self.fail_count == 0 else "FAIL"

    @property
    def exit_code(self) -> int:
        """CI/CD 退出码：0=通过, 1=失败"""
        return 0 if self.fail_count == 0 else 1

    def to_dict(self) -> dict:
        from datetime import timezone
        # 尝试解析执行时间为 ISO 格式
        iso_ts = ""
        try:
            dt = datetime.strptime(
                self.executed_at.replace("CST", "").strip(),
                "%Y-%m-%d %H:%M:%S"
            )
            iso_ts = dt.replace(tzinfo=timezone(timedelta(hours=8))).isoformat()
        except Exception:
            iso_ts = datetime.now(timezone(timedelta(hours=8))).isoformat()

        return {
            "test_name": self.test_name,
            "overall_status": self.overall_status,
            "exit_code": self.exit_code,
            "timestamp": iso_ts,
            "executed_at": self.executed_at,
            "database": self.database,
            "duration_sec": round(self.duration_sec, 1),
            "summary": {
                "total_cases": self.total_cases,
                "total_items": self.total_items,
                "pass": self.pass_count,
                "fail": self.fail_count,
                "warn": self.warn_count,
                "pass_rate": round(self.pass_rate, 1),
            },
            "failed_cases": [
                {
                    "tc_id": c.tc_id,
                    "title": c.title,
                    "failed_items": [
                        {"message": i.message}
                        for i in c.items if i.status == "FAIL"
                    ],
                }
                for c in self.cases if c.fail_count > 0
            ],
            "cases": [
                {
                    "tc_id": c.tc_id,
                    "title": c.title,
                    "status": c.status,
                    "pass": c.pass_count,
                    "fail": c.fail_count,
                    "warn": c.warn_count,
                    "items": [
                        {"status": i.status, "message": i.message, "timing": i.timing}
                        for i in c.items
                    ],
                }
                for c in self.cases
            ],
        }


# ---------- 解析器 ----------

class TestReportParser:
    """解析测试脚本输出"""

    # 正则模式
    RE_CASE_HEADER = re.compile(
        r'══════\s+(TC-\d+):\s*(.+?)\s*══════'
    )
    RE_TEST_ITEM = re.compile(
        r'\[(PASS|FAIL|WARN)\]\s+(.+)'
    )
    RE_INFO = re.compile(
        r'\[INFO\]\s+(.+)'
    )
    RE_TIMING = re.compile(
        r'(\d+)s\s*内|耗时\s*(\d+)s|\(耗时\s*(\d+)s\)'
    )
    RE_EXIT_CODE = re.compile(r'code=(\d+)')
    RE_TOTAL = re.compile(r'总测试项:\s*(\d+)')
    RE_PASS = re.compile(r'通过:\s*(\d+)')
    RE_FAIL = re.compile(r'失败:\s*(\d+)')
    RE_WARN = re.compile(r'警告:\s*(\d+)')
    RE_RATE = re.compile(r'通过率:\s*([\d.]+)%')
    RE_DB = re.compile(r'数据库:\s*(\S+)')
    RE_TIME = re.compile(r'时间:\s*(.+)')

    def __init__(self, test_name: str = "故障排查场景自动化测试"):
        self.test_name = test_name

    def parse(self, output: str) -> TestReport:
        """解析完整输出文本"""
        lines = output.splitlines()
        report = TestReport(
            test_name=self.test_name,
            executed_at="",
            database="",
            raw_output=output,
        )

        current_case: Optional[TestCase] = None

        for line in lines:
            # 去除 ANSI 颜色码
            clean = re.sub(r'\033\[\d+m', '', line)

            # 匹配测试场景标题
            m = self.RE_CASE_HEADER.search(clean)
            if m:
                if current_case:
                    report.cases.append(current_case)
                current_case = TestCase(
                    tc_id=m.group(1),
                    title=m.group(2),
                )
                continue

            # 匹配测试项
            m = self.RE_TEST_ITEM.search(clean)
            if m and current_case:
                status = m.group(1)
                message = m.group(2).strip()
                # 提取耗时
                timing = None
                tm = self.RE_TIMING.search(message)
                if tm:
                    for g in tm.groups():
                        if g:
                            timing = f"{g}s"
                            break
                current_case.items.append(TestItem(
                    status=status,
                    message=message,
                    timing=timing,
                ))
                continue

            # 匹配汇总信息
            m = self.RE_TOTAL.search(clean)
            if m:
                report.total_items = int(m.group(1))
            m = self.RE_PASS.search(clean)
            if m:
                report.pass_count = int(m.group(1))
            m = self.RE_FAIL.search(clean)
            if m:
                report.fail_count = int(m.group(1))
            m = self.RE_WARN.search(clean)
            if m:
                report.warn_count = int(m.group(1))
            m = self.RE_RATE.search(clean)
            if m:
                report.pass_rate = float(m.group(1))

            # 匹配数据库和时间
            m = self.RE_DB.search(clean)
            if m:
                report.database = m.group(1)
            m = self.RE_TIME.search(clean)
            if m:
                report.executed_at = m.group(1).strip()

        # 追加最后一个场景
        if current_case:
            report.cases.append(current_case)

        # 计算场景数
        report.total_cases = len(report.cases)

        # 如果汇总数据为空，从场景中计算
        if report.total_items == 0:
            report.total_items = sum(len(c.items) for c in report.cases)
        if report.pass_count == 0:
            report.pass_count = sum(c.pass_count for c in report.cases)
        if report.fail_count == 0:
            report.fail_count = sum(c.fail_count for c in report.cases)
        if report.warn_count == 0:
            report.warn_count = sum(c.warn_count for c in report.cases)
        if report.pass_rate == 0.0 and report.total_items > 0:
            report.pass_rate = round(
                report.pass_count * 100 / report.total_items, 1
            )

        return report


# ---------- Docker 执行器 ----------

class DockerTestRunner:
    """通过 Docker 执行测试脚本"""

    def __init__(
        self,
        container: str = "nh-backup-scheduler",
        script: str = "/scripts/test-fault-recovery.sh",
    ):
        self.container = container
        self.script = script

    def run(self) -> tuple:
        """执行测试，返回 (输出文本, 耗时秒数, 退出码)"""
        cmd = [
            "docker", "exec", self.container,
            "bash", "-c",
            f"source /tmp/backup-env.sh && bash {self.script}",
        ]
        start = datetime.now()
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,  # 5 分钟超时
                encoding="utf-8",
                errors="replace",
            )
            elapsed = (datetime.now() - start).total_seconds()
            output = result.stdout + result.stderr
            return output, elapsed, result.returncode
        except subprocess.TimeoutExpired:
            elapsed = (datetime.now() - start).total_seconds()
            return f"测试超时 ({elapsed:.0f}s)", elapsed, -1
        except FileNotFoundError:
            return "Docker 命令未找到，请确认 Docker 已安装", 0, -2


# ---------- 报告渲染 ----------

class ReportRenderer:
    """渲染测试报告"""

    # 颜色
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    CYAN = "\033[96m"
    BOLD = "\033[1m"
    RESET = "\033[0m"

    def __init__(self, use_color: bool = True):
        self.use_color = use_color and sys.stdout.isatty()

    def _c(self, color: str, text: str) -> str:
        if self.use_color:
            return f"{color}{text}{self.RESET}"
        return text

    def render(self, report: TestReport) -> str:
        """渲染完整报告"""
        lines = []

        # 标题
        lines.append(self._c(self.BOLD, "=" * 70))
        lines.append(self._c(self.BOLD, f"  {report.test_name} - 解析报告"))
        lines.append(self._c(self.BOLD, "=" * 70))
        lines.append("")

        # 元信息
        lines.append(f"  执行时间:   {report.executed_at or 'N/A'}")
        lines.append(f"  数据库:     {report.database or 'N/A'}")
        lines.append(f"  总耗时:     {report.duration_sec:.1f}s")
        lines.append("")

        # 汇总
        status_color = self.GREEN if report.fail_count == 0 else self.RED
        lines.append(self._c(self.BOLD, "  汇总:"))
        lines.append(f"    测试场景:   {report.total_cases}")
        lines.append(f"    测试项:     {report.total_items}")
        lines.append(
            f"    通过:       {self._c(self.GREEN, str(report.pass_count))}"
        )
        lines.append(
            f"    失败:       {self._c(self.RED, str(report.fail_count))}"
        )
        lines.append(
            f"    警告:       {self._c(self.YELLOW, str(report.warn_count))}"
        )
        lines.append(
            f"    通过率:     {self._c(status_color, f'{report.pass_rate:.1f}%')}"
        )
        lines.append("")

        # 各场景详情
        lines.append(self._c(self.BOLD, "  各场景详情:"))
        lines.append(
            f"  {'场景':<8} {'标题':<28} {'状态':<6} "
            f"{'通过':<6} {'失败':<6} {'警告':<6} {'耗时':<8}"
        )
        lines.append(f"  {'-' * 72}")

        for case in report.cases:
            status_str = {
                "PASS": self._c(self.GREEN, "PASS"),
                "FAIL": self._c(self.RED, "FAIL"),
                "WARN": self._c(self.YELLOW, "WARN"),
            }[case.status]

            # 提取该场景的耗时
            timing = ""
            for item in case.items:
                if item.timing:
                    timing = item.timing
                    break

            lines.append(
                f"  {case.tc_id:<8} {case.title:<28} {status_str:<6} "
                f"{case.pass_count:<6} {case.fail_count:<6} "
                f"{case.warn_count:<6} {timing:<8}"
            )

        lines.append("")

        # 失败项详情
        failed_items = []
        for case in report.cases:
            for item in case.items:
                if item.status == "FAIL":
                    failed_items.append((case.tc_id, item))

        if failed_items:
            lines.append(self._c(self.RED, self.BOLD + "  失败项详情:"))
            for tc_id, item in failed_items:
                lines.append(f"    [{tc_id}] {item.message}")
            lines.append("")

        # 耗时分析
        timing_items = []
        for case in report.cases:
            for item in case.items:
                if item.timing:
                    timing_items.append((case.tc_id, item))

        if timing_items:
            lines.append(self._c(self.CYAN, "  耗时数据:"))
            for tc_id, item in timing_items:
                lines.append(f"    [{tc_id}] {item.message}")
            lines.append("")

        # 结论
        lines.append("=" * 70)
        if report.fail_count == 0:
            lines.append(
                self._c(self.GREEN, self.BOLD +
                        f"  ✅ 全部 {report.total_items} 项测试通过 "
                        f"(通过率 {report.pass_rate:.1f}%, 耗时 {report.duration_sec:.1f}s)")
            )
        else:
            lines.append(
                self._c(self.RED, self.BOLD +
                        f"  ❌ {report.fail_count} 项测试失败，请检查上方详情")
            )
        lines.append("=" * 70)

        return "\n".join(lines)


# ---------- 主函数 ----------

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="备份恢复测试报告解析器"
    )
    parser.add_argument(
        "--file", "-f",
        help="从日志文件解析 (不执行 Docker)",
    )
    parser.add_argument(
        "--container", "-c",
        default="nh-backup-scheduler",
        help="Docker 容器名 (默认: nh-backup-scheduler)",
    )
    parser.add_argument(
        "--script", "-s",
        default="/scripts/test-fault-recovery.sh",
        help="容器内测试脚本路径",
    )
    parser.add_argument(
        "--json", "-j",
        action="store_true",
        help="输出 JSON 格式",
    )
    parser.add_argument(
        "--output", "-o",
        help="输出到文件",
    )
    parser.add_argument(
        "--no-color",
        action="store_true",
        help="禁用颜色输出",
    )
    parser.add_argument(
        "--duration", "-d",
        type=float,
        help="测试总耗时 (秒)，用于 --file 模式",
    )
    args = parser.parse_args()

    # 获取测试输出
    if args.file:
        # 从文件解析
        if not os.path.exists(args.file):
            print(f"错误: 文件不存在: {args.file}")
            sys.exit(1)
        with open(args.file, "r", encoding="utf-8", errors="replace") as f:
            output = f.read()
        duration = 0.0
    else:
        # 执行 Docker 测试
        runner = DockerTestRunner(args.container, args.script)
        print(f"正在执行测试 (容器: {args.container})...")
        output, duration, exit_code = runner.run()

        if exit_code == -2:
            print(f"错误: {output}")
            sys.exit(1)
        elif exit_code == -1:
            print(f"警告: {output}")

    # 解析
    parser_obj = TestReportParser()
    report = parser_obj.parse(output)
    report.duration_sec = args.duration if args.duration else duration

    # 输出
    if args.json:
        result = json.dumps(report.to_dict(), ensure_ascii=False, indent=2)
    else:
        renderer = ReportRenderer(use_color=not args.no_color)
        result = renderer.render(report)

    # 打印或写文件
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result)
        print(f"报告已保存到: {args.output}")
    else:
        print(result)

    # 退出码
    sys.exit(0 if report.fail_count == 0 else 1)


if __name__ == "__main__":
    main()
