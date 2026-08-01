#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
JSON 转 YAML 转换器
============================================================
将 PR 评论结果 JSON 文件转换为 YAML 格式，方便 CI/CD 配置

用法:
  python3 json_to_yaml.py input.json output.yaml
  python3 json_to_yaml.py input.json              # 输出到 stdout
  python3 json_to_yaml.py --dir /path/to/reports  # 批量转换目录内所有 JSON
============================================================
"""

import json
import sys
import os
import argparse
import yaml
from datetime import datetime


def convert_json_to_yaml(json_path: str, yaml_path: str = None) -> str:
    """将 JSON 文件转换为 YAML 格式"""
    with open(json_path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    # 将 comment_markdown 从数组转为多行字符串
    if "comment_markdown" in data:
        cmd = data["comment_markdown"]
        if isinstance(cmd, list):
            data["comment_markdown"] = "\n".join(cmd)

    # 自定义 YAML 输出格式
    class LiteralStr(str):
        """YAML 字面量字符串，使用 | 块标量"""
        pass

    def str_representer(dumper, data):
        if "\n" in data:
            return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
        return dumper.represent_scalar("tag:yaml.org,2002:str", data)

    yaml.add_representer(str, str_representer)

    yaml_content = yaml.dump(
        data,
        allow_unicode=True,          # 保留中文
        default_flow_style=False,     # 块格式（非流式）
        sort_keys=False,              # 保持原始键顺序
        width=120,                    # 行宽
        indent=2,                     # 缩进
    )

    if yaml_path:
        with open(yaml_path, "w", encoding="utf-8") as f:
            f.write(yaml_content)
        print(f"YAML 已保存到: {yaml_path}", file=sys.stderr)
    else:
        print(yaml_content)

    return yaml_content


def convert_dir(json_dir: str):
    """批量转换目录内所有 JSON 文件"""
    json_files = sorted([
        f for f in os.listdir(json_dir)
        if f.endswith(".json") and f != "index.json"
    ])

    if not json_files:
        print(f"目录 {json_dir} 中没有 JSON 文件", file=sys.stderr)
        return

    for jf in json_files:
        json_path = os.path.join(json_dir, jf)
        yaml_path = os.path.join(json_dir, jf.replace(".json", ".yaml"))
        convert_json_to_yaml(json_path, yaml_path)

    # 转换 index.json
    index_path = os.path.join(json_dir, "index.json")
    if os.path.exists(index_path):
        convert_json_to_yaml(index_path, os.path.join(json_dir, "index.yaml"))

    print(f"\n共转换 {len(json_files)} 个文件", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="JSON 转 YAML 转换器")
    parser.add_argument("input", nargs="?", help="JSON 文件路径")
    parser.add_argument("output", nargs="?", help="YAML 输出路径 (默认 stdout)")
    parser.add_argument("--dir", "-d", help="批量转换目录内所有 JSON 文件")
    args = parser.parse_args()

    if args.dir:
        convert_dir(args.dir)
    elif args.input:
        if not os.path.exists(args.input):
            print(f"错误: 文件不存在: {args.input}", file=sys.stderr)
            sys.exit(1)
        convert_json_to_yaml(args.input, args.output)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
