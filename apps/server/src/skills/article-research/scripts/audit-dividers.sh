#!/usr/bin/env bash
# audit-dividers.sh
# 强制检查调研与文章输出目录中所有 .md 文件是否含有独立的 Markdown 分割线（---）
# 用法: bash audit-dividers.sh <目录路径>
# 若发现任何违规行，输出详情并以 exit code 1 退出

TARGET="${1:-.}"

echo "🔍 扫描目录：$TARGET"
echo "---------------------------------------"

VIOLATIONS=$(node -e '
const fs = require("fs");
const path = require("path");

function walk(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const stat = fs.statSync(path.join(dir, file));
    if (stat.isDirectory()) {
      if (file !== "node_modules" && file !== ".git") {
        walk(path.join(dir, file), fileList);
      }
    } else if (file.endsWith(".md")) {
      fileList.push(path.join(dir, file));
    }
  }
  return fileList;
}

const target = process.argv[1];
if (!fs.existsSync(target)) {
  process.exit(0);
}
const stat = fs.statSync(target);
const files = stat.isDirectory() ? walk(target) : [target];
const violations = [];

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  let inFrontmatter = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (i === 0 && line.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && line.trim() === "---") {
      inFrontmatter = false;
      continue;
    }
    if (line.trim() === "---") {
      violations.push(`${file}:${i + 1}:---`);
    }
  }
}

if (violations.length > 0) {
  console.log(violations.join("\n"));
  process.exit(1);
}
' "$TARGET" 2>/dev/null || true)

if [ -z "$VIOLATIONS" ]; then
  echo "✅ 全部通过：未发现任何独立分割线（---），可安全交付。"
  exit 0
else
  echo "❌ 发现以下文件中存在非法分割线，必须修复后才能交付："
  echo ""
  echo "$VIOLATIONS"
  echo ""
  echo "快速修复命令："
  echo "  node -e \"const fs=require('fs'),f=process.argv[1],lines=fs.readFileSync(f,'utf8').split('\\n'),inCode=[false],out=[];for(const l of lines){if(l.startsWith('\`\`\`'))inCode[0]=!inCode[0];if(!inCode[0]&&l.trim()==='---')continue;out.push(l);}fs.writeFileSync(f,out.join('\\n').replace(/\\n{3,}/g,'\\n\\n'));\" <文件路径>"
  echo ""
  exit 1
fi
