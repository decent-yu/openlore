#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const help = `用法：node render-svg.mjs <文件.svg|目录> [参数]
  --output, -o PATH       单文件的目标 PNG
  --output-dir DIR       输出目录，批量时保留子目录结构
  --width N              按宽度渲染，保持比例
  --height N             按高度渲染，保持比例
  --scale N              缩放倍数，默认 2；与 width/height 互斥
  --background COLOR     背景色；默认透明
  --font PATH            字体文件，可重复传入
  --font-family NAME     默认字体名称
  --no-system-fonts      只使用显式加载的字体
  --overwrite            允许替换已有 PNG
  --help, -h             显示帮助
依赖：先在本脚本目录执行 npm ci --no-audit --no-fund
`;

function positive(value, name, integer = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isSafeInteger(number))) {
    throw new Error(`${name} 必须是正${integer ? '整数' : '数'}`);
  }
  return number;
}

function collect(folder) {
  const files = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...collect(full));
    else if (entry.isFile() && /\.svg$/i.test(entry.name)) files.push(full);
  }
  return files;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      'output-dir': { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      scale: { type: 'string' },
      background: { type: 'string' },
      font: { type: 'string', multiple: true },
      'font-family': { type: 'string' },
      'no-system-fonts': { type: 'boolean' },
      overwrite: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (positionals.length !== 1) throw new Error(help);
  if (values.output !== undefined && values['output-dir'] !== undefined) {
    throw new Error('--output 与 --output-dir 不能同时使用');
  }
  const dimensions = ['width', 'height', 'scale'].filter((key) => values[key] !== undefined);
  if (dimensions.length > 1) throw new Error('--width、--height、--scale 互斥');
  const mode = dimensions[0] || 'scale';
  const value = positive(values[mode] ?? '2', `--${mode}`, mode !== 'scale');
  const input = path.resolve(positionals[0]);
  const stat = fs.statSync(input);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('输入必须是 SVG 文件或目录');
  const directory = stat.isDirectory();
  if (directory && values.output !== undefined) throw new Error('目录输入请使用 --output-dir');
  if (!directory && !/\.svg$/i.test(input)) throw new Error('输入文件扩展名必须是 .svg');
  const files = directory ? collect(input) : [input];
  if (!files.length) throw new Error(`没有找到 SVG：${input}`);
  const outputRoot = path.resolve(values['output-dir'] || (directory ? input : path.dirname(input)));
  const jobs = files.map((source) => {
    const relative = directory ? path.relative(input, source) : path.basename(source);
    const target = values.output !== undefined
      ? path.resolve(values.output)
      : path.join(outputRoot, relative.replace(/\.svg$/i, '.png'));
    if (!/\.png$/i.test(target)) throw new Error(`目标必须是 .png：${target}`);
    if (!values.overwrite && fs.existsSync(target)) throw new Error(`目标已存在，用 --overwrite 更新：${target}`);
    return { source, target };
  });
  if (new Set(jobs.map((job) => job.target)).size !== jobs.length) {
    throw new Error('多个 SVG 对应同一个 PNG 路径，请重命名源文件');
  }
  const fontFiles = (values.font || []).map((font) => {
    const absolute = path.resolve(font);
    if (!fs.statSync(absolute).isFile()) throw new Error(`字体不是文件：${absolute}`);
    return absolute;
  });
  let Resvg;
  try {
    ({ Resvg } = await import('@resvg/resvg-js'));
  } catch (error) {
    throw new Error(`无法加载渲染依赖；请在本脚本目录执行 npm ci --no-audit --no-fund\n${error.message}`);
  }
  const options = {
    fitTo: { mode: mode === 'scale' ? 'zoom' : mode, value },
    font: {
      fontFiles,
      loadSystemFonts: !values['no-system-fonts'],
      ...(values['font-family'] ? { defaultFontFamily: values['font-family'] } : {}),
    },
    ...(values.background ? { background: values.background } : {}),
  };
  for (const { source, target } of jobs) {
    try {
      const renderer = new Resvg(fs.readFileSync(source), options);
      const unresolved = renderer.imagesToResolve();
      if (unresolved.length) throw new Error('包含未解析的外部图片，请嵌入为 data URI');
      const rendered = renderer.render();
      const png = rendered.asPng();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, png, { flag: values.overwrite ? 'w' : 'wx' });
      console.log(JSON.stringify({ source, output: target, width: rendered.width, height: rendered.height, bytes: png.length }));
    } catch (error) {
      throw new Error(`${source}: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
