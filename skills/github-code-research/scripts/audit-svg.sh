#!/usr/bin/env bash
# Check SVG XML only. Layout, dimensions, palette and drawing syntax are unrestricted.
set -eu
python3 - "${1:-.}" <<'PY'
import pathlib, sys, xml.etree.ElementTree as ET
root = pathlib.Path(sys.argv[1])
if not root.exists():
    raise SystemExit('指定路径不存在：' + str(root))
files = sorted(root.rglob('*.svg')) if root.is_dir() else [root]
errors = []
for file in files:
    try:
        tree = ET.parse(file)
        if tree.getroot().tag.rsplit('}', 1)[-1] != 'svg':
            raise ValueError('根元素不是 SVG')
    except (OSError, ET.ParseError, ValueError) as error:
        errors.append(f'{file}: {error}')
if errors:
    print('\n'.join(errors))
    raise SystemExit(1)
print(f'已检查 {len(files)} 个 SVG 的 XML 格式；未限制图型、布局或 SVG 写法，仍需实际渲染核验。')
PY
