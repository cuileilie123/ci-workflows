#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从样本 JSON 生成三种测试场景的 HTML PR 评论"""

import json
import subprocess
import os

SAMPLES_FILE = "/tmp/test-pr-samples.json"

with open(SAMPLES_FILE, "r", encoding="utf-8") as f:
    data = json.load(f)

for sample in data["samples"]:
    name = sample["name"]
    report = sample["report"]

    tmp = f"/tmp/sample-{name}.json"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    result = subprocess.run(
        ["python3", "/scripts/pr-comment.py", "--report", tmp, "--html"],
        capture_output=True, text=True
    )

    out = f"/tmp/sample-{name}.md"
    with open(out, "w", encoding="utf-8") as f:
        f.write(result.stdout)

    status = report["overall_status"]
    passed = report["summary"]["pass"]
    total = report["summary"]["total_items"]
    print(f"=== {name} ===")
    print(f"  状态: {status}")
    print(f"  通过: {passed}/{total}")
    print(f"  文件: {out}")
    print()
