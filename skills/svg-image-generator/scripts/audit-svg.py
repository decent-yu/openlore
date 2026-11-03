#!/usr/bin/env python3
"""Check XML and SVG roots without imposing a drawing style."""

import argparse
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def svg_files(root):
    if root.is_file():
        return [root] if root.suffix.lower() == ".svg" else []
    if not root.is_dir():
        return []
    files = []
    for child in sorted(root.iterdir()):
        if child.is_symlink() or child.name.startswith("."):
            continue
        files.extend(svg_files(child))
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="SVG 文件或目录")
    args = parser.parse_args()
    if not args.path.exists():
        parser.error(f"路径不存在：{args.path}")
    files = svg_files(args.path)
    if not files:
        parser.error(f"没有找到 SVG：{args.path}")
    errors = []
    for file in files:
        try:
            root = ET.parse(file).getroot()
            if root.tag not in ("svg", "{http://www.w3.org/2000/svg}svg"):
                raise ValueError("根元素不是 SVG")
        except (OSError, ET.ParseError, ValueError) as error:
            errors.append(f"{file}: {error}")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"已检查 {len(files)} 个 SVG 的 XML；仍需渲染并查看实际图片。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
