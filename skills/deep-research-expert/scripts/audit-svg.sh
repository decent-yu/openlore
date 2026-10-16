#!/usr/bin/env bash
# audit-svg.sh
# 强制检查文章 assets/ 目录中的所有 SVG 是否符合工程视觉红线规范
# 用法: bash audit-svg.sh <文章或assets目录路径>

TARGET="${1:-.}"

echo "🔍 扫描 SVG 图表规范：$TARGET"
echo "---------------------------------------"

node -e '
const fs = require("fs");
const path = require("path");

function walk(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (file !== "node_modules" && file !== ".git") {
        walk(full, fileList);
      }
    } else if (file.endsWith(".svg")) {
      fileList.push(full);
    }
  }
  return fileList;
}

const target = process.argv[1];
const stat = fs.existsSync(target) ? fs.statSync(target) : null;
if (!stat) {
  console.log("未找到指定路径，跳过检查。");
  process.exit(0);
}
const svgFiles = stat.isDirectory() ? walk(target) : [target];

if (svgFiles.length === 0) {
  console.log("ℹ️  未扫描到 .svg 文件。");
  process.exit(0);
}

let hasError = false;

for (const f of svgFiles) {
  const content = fs.readFileSync(f, "utf8");
  const errors = [];

  // 1. viewBox 检查
  if (!content.includes("viewBox=")) {
    errors.push("缺少 viewBox 声明，可能导致不同屏幕上非等比缩放失真");
  }

  // 2. Anti-Path-Concat Bug 检查: 单个 path 中多个 M... 且带 marker-end
  const pathMatches = content.match(/<path[^>]*d="[^"]+"[^>]*marker-end=[^>]*>/g) || [];
  for (const pm of pathMatches) {
    const dMatch = pm.match(/d="([^"]+)"/);
    if (dMatch) {
      const mCount = (dMatch[1].match(/[Mm]/g) || []).length;
      if (mCount > 1) {
        errors.push("检测到 Anti-Path-Concat 连线合并缺陷（单个 <path> 包含多个 M... 且使用 marker-end，前序箭头将丢失，必须拆为独立连线）");
      }
    }
  }

  // 3. 英文小徽章反模式检测 (PARADIGM SHIFT / DELIVERY PIPELINE 等假洋文)
  if (content.match(/letter-spacing="1">([A-Z\s]{4,})<\/text>/)) {
    errors.push("主标题上方检测到装饰性全大写英文小标签徽章，请移除并保持纯净直接的中文标题");
  }

  if (errors.length > 0) {
    hasError = true;
    console.log(`❌ 文件违规: ${f}`);
    for (const err of errors) {
      console.log(`   - ${err}`);
    }
    console.log("");
  }
}

if (hasError) {
  console.log("❌ 请根据 references/visual_and_assets_guide.md 修复上述 SVG 缺陷后再行交付。");
  process.exit(1);
} else {
  console.log(`✅ 全部通过：已检查 ${svgFiles.length} 个 SVG 文件，均符合工程视觉规范。`);
  process.exit(0);
}
' "$TARGET"
