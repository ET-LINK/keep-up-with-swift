#!/usr/bin/env node
// Swift Club 构建脚本
//
//   content/*.md  ──解析──▶  每个 Swift 代码块交给本机 swiftc 真实编译/运行
//                 ──输出──▶  assets/data.js        （站点数据）
//                            index.html            （本地打开即可用）
//                            dist/swift-club.html  （单文件版，可直接发布）
//
// 用法：
//   node tools/build.mjs              编译并校验所有示例（带缓存）
//   node tools/build.mjs --fresh      忽略缓存，全部重新编译
//   node tools/build.mjs --no-compile 只用缓存，不调用 swiftc
//
// 代码块属性（写在 ```swift 之后）：
//   title="…"      代码块标题
//   check=ok       必须编译通过（默认）
//   check=error    必须报错（用来展示真实的编译器诊断）
//   check=warning  必须编译通过且至少有一条警告
//   check=run      编译并运行，展示真实输出
//   check=none     不编译（Package.swift、C 头文件、命令行等）
//   flags="…"      额外的 swiftc 参数，默认 -swift-version 6
//   script         作为 main.swift 顶层代码编译（run 模式自动启用）
//   testing        链接 Swift Testing / XCTest
//   expect="…"     诊断或输出里必须出现的文字
//   hl="2,5-7"     高亮的行号

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Set(process.argv.slice(2));
const FRESH = argv.has('--fresh');
const NO_COMPILE = argv.has('--no-compile');
const CACHE_FILE = path.join(ROOT, 'tools', '.compile-cache.json');
const DEFAULT_FLAGS = '-swift-version 6';

// ───────────────────────── 工具函数 ─────────────────────────

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, p), s);
};
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 120000, cwd: opts.cwd, env: { ...process.env, NO_COLOR: '1' } });
  return { code: r.status ?? (r.signal ? 128 : 1), out: r.stdout ?? '', err: r.stderr ?? '', signal: r.signal };
}

// ───────────────────────── 编译器环境 ─────────────────────────

const compilerVersion = NO_COMPILE ? '' : run('swiftc', ['--version']).out.trim() || run('swiftc', ['--version']).err.trim();
let devDir = '';
try { devDir = run('xcode-select', ['-p']).out.trim(); } catch { /* 非 macOS */ }
const testingFlags = devDir
  ? [
      '-F', `${devDir}/Platforms/MacOSX.platform/Developer/Library/Frameworks`,
      '-I', `${devDir}/Platforms/MacOSX.platform/Developer/usr/lib`,
      '-plugin-path', `${devDir}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/host/plugins/testing`,
    ]
  : [];

let cache = {};
if (!FRESH && fs.existsSync(CACHE_FILE)) {
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
}
// 缓存键里带着完整的编译器版本；--no-compile 时沿用缓存里记下的版本，才能命中缓存
const keyVersion = compilerVersion || cache.__compilerFull || 'cached';
const usedCache = {};
let compiled = 0, fromCache = 0;

function splitFlags(s) {
  return (s || '').match(/"[^"]*"|\S+/g)?.map((t) => t.replace(/^"|"$/g, '')) ?? [];
}

function cleanDiag(text, dir) {
  return text
    .split(dir + '/').join('')
    .split(devDir).join('<Xcode>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
}

/** 编译（并可选运行）一段 Swift 代码，返回真实结果 */
function compile({ code, flags, mode, script, testing, prelude }) {
  const key = sha(JSON.stringify({ code, flags, mode, script, testing, prelude, v: keyVersion }));
  if (!FRESH && cache[key]) { usedCache[key] = cache[key]; fromCache++; return cache[key]; }
  if (NO_COMPILE) return { status: 'skipped', diagnostics: '', output: '', command: '' };

  const dir = fs.mkdtempSync(path.join(process.env.SWIFT_CLUB_TMP || os.tmpdir(), 'swiftclub-'));
  fs.writeFileSync(path.join(dir, 'main.swift'), code + '\n');
  const files = ['main.swift'];
  if (prelude) { fs.writeFileSync(path.join(dir, 'Support.swift'), prelude + '\n'); files.push('Support.swift'); }
  const userFlags = splitFlags(flags || DEFAULT_FLAGS);
  const extra = [...(testing ? testingFlags : []), ...((mode === 'run' || script) ? [] : ['-parse-as-library'])];
  let result;
  if (mode === 'run') {
    const c = run('swiftc', [...userFlags, ...extra, '-o', 'prog', ...files], { cwd: dir });
    const diagnostics = cleanDiag(c.err, dir);
    if (c.code !== 0) {
      result = { status: 'error', diagnostics, output: '' };
    } else {
      const r = run(path.join(dir, 'prog'), [], { cwd: dir, timeout: 15000 });
      result = { status: r.code === 0 ? (/warning:/.test(diagnostics) ? 'warning' : 'ok') : 'crash', diagnostics, output: (r.out + (r.err ? r.err : '')).replace(/\s+$/, ''), exit: r.code };
    }
  } else {
    const c = run('swiftc', [...userFlags, ...extra, '-wmo', '-emit-sil', '-o', '/dev/null', ...files], { cwd: dir });
    const diagnostics = cleanDiag(c.err, dir);
    const status = c.code !== 0 || /error:/.test(diagnostics) ? 'error' : /warning:/.test(diagnostics) ? 'warning' : 'ok';
    result = { status, diagnostics, output: '' };
  }
  result.command = ['swiftc', ...userFlags, ...(testing ? ['（链接 Swift Testing）'] : []), mode === 'run' ? 'main.swift && ./main' : 'main.swift'].join(' ');
  fs.rmSync(dir, { recursive: true, force: true });
  cache[key] = result; usedCache[key] = result; compiled++;
  return result;
}

// ───────────────────────── 行内 Markdown ─────────────────────────

const evo = JSON.parse(read('tools/evolution-snapshot.json'));
const proposalById = new Map(evo.proposals.map((p) => [p.id, p]));
const proposalUrl = (id) => {
  const p = proposalById.get(id);
  return p ? `https://github.com/swiftlang/swift-evolution/blob/main/proposals/${p.link}` : `https://github.com/swiftlang/swift-evolution`;
};

function inline(md) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = md;
  // ``code`` 与 `code`
  s = s.replace(/``\s?([\s\S]+?)\s?``|`([^`\n]+)`/g, (_, a, b) => keep(`<code>${esc(a ?? b)}</code>`));
  // [文字](链接)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    const ext = /^https?:/.test(u);
    return keep(`<a href="${esc(u)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${inline(t)}</a>`);
  });
  // SE-0461 → 提案链接
  s = s.replace(/\bSE-(\d{4})\b/g, (m) => keep(`<a class="se-link" href="${proposalUrl(m)}" target="_blank" rel="noopener">${m}</a>`));
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i]);
  return s;
}

// ───────────────────────── 块级解析 ─────────────────────────

function parseAttrs(s) {
  const attrs = {};
  const re = /(\w[\w-]*)(?:=("([^"]*)"|\S+))?/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1]] = m[3] ?? (m[2] ?? true);
  return attrs;
}

function parseHeader(lines, i) {
  const meta = {};
  let lastKey = null;
  while (i < lines.length && lines[i].trim() !== '') {
    const l = lines[i];
    const m = /^([a-z][\w-]*):\s?(.*)$/.exec(l);
    if (m && !/^\s/.test(l)) { meta[m[1]] = m[2].replace(/^"(.*)"$/, '$1'); lastKey = m[1]; }
    else if (lastKey) meta[lastKey] += '\n' + l.trim();
    i++;
  }
  return [meta, i];
}

function parseBody(lines, ctx) {
  const blocks = [];
  let i = 0;
  let para = [];
  const flushPara = () => { if (para.length) { blocks.push({ type: 'p', html: inline(para.join(' ')) }); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```(\w+)?\s*(.*)$/.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1] || 'text';
      const attrs = parseAttrs(fence[2] || '');
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push(makeCode(lang, attrs, buf.join('\n'), ctx));
      continue;
    }
    const box = /^:::\s*(\w+)\s*(.*)$/.exec(line);
    if (box) {
      flushPara();
      const kind = box[1];
      const title = box[2] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      if (kind === 'quiz') blocks.push(makeQuiz(buf, ctx));
      else blocks.push({ type: 'callout', kind, title: inline(title), blocks: parseBody(buf, ctx) });
      continue;
    }
    if (/^###\s+/.test(line)) { flushPara(); blocks.push({ type: 'h', html: inline(line.replace(/^###\s+/, '')) }); i++; continue; }
    if (/^\|/.test(line)) {
      flushPara();
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells.map(inline));
        i++;
      }
      blocks.push({ type: 'table', head: rows[0], rows: rows.slice(1) });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^([-*]\s+|\s{2,}\S)/.test(lines[i])) {
        if (/^[-*]\s+/.test(lines[i])) items.push(lines[i].replace(/^[-*]\s+/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      blocks.push({ type: 'list', items: items.map(inline) });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^(\d+\.\s+|\s{2,}\S)/.test(lines[i])) {
        if (/^\d+\.\s+/.test(lines[i])) items.push(lines[i].replace(/^\d+\.\s+/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      blocks.push({ type: 'olist', items: items.map(inline) });
      continue;
    }
    if (line.trim() === '') { flushPara(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flushPara();
  return blocks;
}

const problems = [];

function makeCode(lang, attrs, code, ctx) {
  const block = { type: 'code', lang, title: attrs.title ? inline(attrs.title) : '', code, hl: attrs.hl || '' };
  if (attrs.file) block.file = attrs.file;
  const check = lang === 'swift' ? (attrs.check || 'ok') : 'none';
  block.check = check;
  if (check === 'none') return block;
  const mode = check === 'run' ? 'run' : 'check';
  const flags = attrs.flags || DEFAULT_FLAGS;
  const prelude = attrs.prelude ? ctx.preludes?.[attrs.prelude] : undefined;
  if (attrs.prelude && prelude === undefined) problems.push(`${ctx.where}: 找不到 prelude "${attrs.prelude}"`);
  const r = compile({ code, flags, mode, script: !!attrs.script, testing: !!attrs.testing, prelude });
  block.flags = flags;
  block.result = r;
  const where = `${ctx.where} › ${attrs.title || '代码块'}`;
  const text = r.diagnostics + '\n' + r.output;
  if (r.status === 'skipped') return block;
  if (check === 'ok' && r.status !== 'ok') problems.push(`${where}: 期望编译通过，实际 ${r.status}\n${r.diagnostics}`);
  if (check === 'error' && r.status !== 'error') problems.push(`${where}: 期望报错，实际 ${r.status}`);
  if (check === 'warning' && r.status !== 'warning') problems.push(`${where}: 期望警告，实际 ${r.status}\n${r.diagnostics}`);
  if (check === 'run' && !['ok', 'warning'].includes(r.status)) problems.push(`${where}: 运行失败 ${r.status}\n${r.diagnostics}\n${r.output}`);
  if (check === 'run' && r.status === 'warning' && !attrs.warn) problems.push(`${where}: 运行示例产生了警告\n${r.diagnostics}`);
  if (attrs.expect && !text.includes(attrs.expect)) problems.push(`${where}: 输出中没有找到 "${attrs.expect}"\n${text}`);
  if (/are not allowed at the top level/.test(r.diagnostics)) problems.push(`${where}: 顶层语句需要加 script 属性，否则报的不是想展示的错误`);
  return block;
}

function makeQuiz(lines, ctx) {
  const q = { type: 'quiz', question: '', options: [], answer: -1, explain: '' };
  const qs = [], ex = [];
  for (const l of lines) {
    if (/^\?\s/.test(l)) qs.push(l.slice(2));
    else if (/^\+\s/.test(l)) { q.answer = q.options.length; q.options.push(inline(l.slice(2))); }
    else if (/^-\s/.test(l)) q.options.push(inline(l.slice(2)));
    else if (/^>\s?/.test(l)) ex.push(l.replace(/^>\s?/, ''));
  }
  q.question = inline(qs.join(' '));
  q.explain = inline(ex.join(' '));
  if (q.answer < 0) problems.push(`${ctx.where}: 小测没有标记正确答案（用 + 开头）`);
  return q;
}

// ───────────────────────── 读取内容 ─────────────────────────

const site = JSON.parse(read('content/site.json'));
const releaseFiles = site.releases.map((r) => r.file);
const releases = [];
const features = [];

for (const file of releaseFiles) {
  const src = read(`content/${file}`);
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!fm) throw new Error(`${file} 缺少 frontmatter`);
  const [rmeta] = parseHeader(fm[1].split('\n'), 0);
  const rest = src.slice(fm[0].length);
  const preludes = {};
  const parts = rest.split(/^## /m).slice(1);
  const rel = {
    version: rmeta.version, id: 'v' + rmeta.version.replace(/\./g, ''), date: rmeta.date, title: rmeta.title,
    subtitle: rmeta.subtitle || '', summary: inline(rmeta.summary || ''), blog: rmeta.blog || '', features: [],
  };
  for (const part of parts) {
    const lines = part.split('\n');
    const id = lines[0].trim();
    const [meta, after] = parseHeader(lines, 1);
    if (id.startsWith('prelude ')) {
      const body = lines.slice(after).join('\n');
      const m = /```swift[^\n]*\n([\s\S]*?)\n```/.exec(body);
      preludes[id.slice(8).trim()] = m ? m[1] : '';
      continue;
    }
    const ctx = { where: `${file} › ${id}`, preludes };
    const se = (meta.se || '').split(/[,\s]+/).filter(Boolean).map((x) => (/^\d+$/.test(x) ? `SE-${x.padStart(4, '0')}` : x));
    const f = {
      id, release: rel.version, since: meta.since || rel.version, title: inline(meta.title || id), plainTitle: (meta.title || id).replace(/`/g, ''),
      en: meta.en || '', line: +meta.line || 3, level: meta.level || 'key', short: meta.short || meta.title,
      tags: meta.tags || '', tldr: inline(meta.tldr || ''), flag: meta.flag || '',
      se: se.map((x) => ({ id: x, url: x.startsWith('SE-') ? proposalUrl(x) : (meta[`url-${x}`] || ''), title: proposalById.get(x)?.title || '' })),
      links: (meta.links || '').split('\n').filter(Boolean).map((l) => { const m = /^(.*?)\s*\|\s*(\S+)$/.exec(l); return m ? { text: m[1], url: m[2] } : null; }).filter(Boolean),
      blocks: parseBody(lines.slice(after), ctx),
    };
    if (!site.lines.some((l) => l.id === f.line)) problems.push(`${ctx.where}: 未知线路 ${meta.line}`);
    if (features.some((x) => x.id === id)) problems.push(`${ctx.where}: 重复的特性 id`);
    features.push(f);
    rel.features.push(id);
  }
  releases.push(rel);
}

// ───────────── 编译器猜猜看 ─────────────
const challenges = [];
{
  const src = read('content/challenges.md');
  for (const part of src.split(/^## /m).slice(1)) {
    const lines = part.split('\n');
    const id = lines[0].trim();
    const [meta, after] = parseHeader(lines, 1);
    const body = lines.slice(after).join('\n');
    const m = /```swift([^\n]*)\n([\s\S]*?)\n```/.exec(body);
    if (!m) { problems.push(`challenges › ${id}: 缺少代码`); continue; }
    const attrs = parseAttrs(m[1]);
    const code = m[2];
    const r = compile({ code, flags: meta.flags || DEFAULT_FLAGS, mode: 'check', script: !!attrs.script });
    const actual = r.status;
    if (meta.expect && meta.expect !== actual) problems.push(`challenges › ${id}: 预期 ${meta.expect}，编译器实际给出 ${actual}\n${r.diagnostics}`);
    challenges.push({ id, title: inline(meta.title || ''), topic: meta.topic || '', related: meta.related || '', flags: meta.flags || DEFAULT_FLAGS, code, answer: actual, diagnostics: r.diagnostics, explain: inline(meta.explain || '') });
  }
}

// ───────────── 实验室 ─────────────
const labs = {};
{
  const src = read('content/labs.md');
  for (const part of src.split(/^## /m).slice(1)) {
    const lines = part.split('\n');
    const id = lines[0].trim();
    const [meta, after] = parseHeader(lines, 1);
    const body = lines.slice(after).join('\n');
    const m = /```swift([^\n]*)\n([\s\S]*?)\n```/.exec(body);
    const entry = { id, title: inline(meta.title || ''), note: inline(meta.note || ''), flags: meta.flags || DEFAULT_FLAGS };
    if (m) {
      const attrs = parseAttrs(m[1]);
      const mode = attrs.check === 'run' ? 'run' : 'check';
      entry.code = m[2];
      entry.result = compile({ code: m[2], flags: entry.flags, mode, script: !!attrs.script });
      if (meta.expect && meta.expect !== entry.result.status) problems.push(`labs › ${id}: 预期 ${meta.expect}，实际 ${entry.result.status}\n${entry.result.diagnostics}`);
    }
    if (meta.steps) {
      entry.steps = meta.steps.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
        const [lane, mark, text] = s.split('|').map((x) => x.trim());
        return { lane, mark, text: inline(text || '') };
      });
    }
    labs[id] = entry;
  }
  if (labs['memory-table']?.result?.output) {
    try { labs['memory-table'].table = JSON.parse(labs['memory-table'].result.output); } catch (e) { problems.push('labs › memory-table: 输出不是 JSON'); }
  }
}

// ───────────── 提案总表 ─────────────
const featureBySE = new Map();
for (const f of features) for (const s of f.se) if (!featureBySE.has(s.id)) featureBySE.set(s.id, f);
const guessLine = (t) => {
  if (/package|swiftpm|sbom|registry|template|coverage|build performance|plugin command|mirrors|testable|traits|cross-compilation|sdk/i.test(t)) return 6;
  if (/warning|diagnos|migration|language mode|language version|debugdescription|backtrace|demangle|test/i.test(t)) return 6;
  if (/task|actor|isolat|sendable|async|concurren|executor|continuation|deinit|observation|disconnected|deadline|cancel/i.test(t)) return 1;
  if (/span|copyable|escapable|inline|memory|unsafe|lifetime|abi|specializ|borrow|yield|bitwise|allocation|uniquebox|uniquearray|ref\b|section|consum|atomic|mutex|lock/i.test(t)) return 2;
  if (/objective-c|\bc\b|c\+\+|java|wasm|cdecl|interop|module selector|implementation/i.test(t)) return 5;
  if (/string|collection|dictionary|array|integer|duration|clock|hashable|regex|filepath|reduce|count|result|unicode|identical|float|utf8/i.test(t)) return 4;
  return 3;
};
const proposals = evo.proposals.map((p) => {
  const f = featureBySE.get(p.id);
  return { id: p.id, title: p.title, state: p.state, version: p.version, url: proposalUrl(p.id), flag: p.flag, line: f ? f.line : guessLine(p.title), feature: f ? f.id : '' };
});

// ───────────────────────── 输出 ─────────────────────────

if (problems.length) {
  console.error(`\n✗ ${problems.length} 个问题：\n`);
  for (const p of problems) console.error('• ' + p + '\n');
}

const allBlocks = features.flatMap((f) => f.blocks);
const verified = allBlocks.filter((b) => b.type === 'code' && b.result && b.result.status !== 'skipped').length + challenges.length + Object.values(labs).filter((l) => l.result).length;
const data = {
  meta: {
    compiler: (compilerVersion.split('\n')[0] || cache.__compiler || '').trim(),
    builtAt: new Date().toISOString().slice(0, 10),
    verified,
    evolutionDate: (evo.creationDate || '').slice(0, 10),
  },
  lines: site.lines, routes: site.routes, releaseInfo: site.releases,
  releases, features, challenges, labs, proposals,
};
if (!data.meta.compiler && cache.__compiler) data.meta.compiler = cache.__compiler;
usedCache.__compiler = data.meta.compiler;
usedCache.__compilerFull = keyVersion;
// --no-compile 什么也没编译，不改写缓存文件，免得把这次没命中的条目删掉
if (!NO_COMPILE) fs.writeFileSync(CACHE_FILE, JSON.stringify(usedCache));

const json = JSON.stringify(data).replace(/</g, '\\u003c');
write('assets/data.js', `/* 由 tools/build.mjs 生成，请勿手改 */\nwindow.SWIFT_CLUB = ${json};\n`);

// 页面：本地版（完整文档）与单文件发布版
const page = read('src/page.html');
const [headPart, bodyPart] = page.split('<!-- BODY -->');
const css = read('assets/style.css');
const app = read('assets/app.js');
write('index.html', `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${headPart.trim()}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%23f05138'/%3E%3Cpath d='M8.5 21 L14.5 14.5 H23.5' fill='none' stroke='%23fff' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='8.5' cy='21' r='3.3' fill='%23fff'/%3E%3Ccircle cx='23.5' cy='14.5' r='3.3' fill='%23fff'/%3E%3C/svg%3E">
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
${bodyPart.trim()}
<script src="assets/data.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
`);
write('dist/swift-club.html', `${headPart.trim()}
<style>
${css}
</style>
${bodyPart.trim()}
<script>window.SWIFT_CLUB = ${json};</script>
<script>
${app.replace(/<\/script/gi, '<\\/script')}
</script>
`);

const kb = (p) => (fs.statSync(path.join(ROOT, p)).size / 1024).toFixed(0) + ' KB';
console.log(`✓ ${releases.length} 个版本 · ${features.length} 个特性 · ${challenges.length} 道挑战 · ${verified} 段代码经编译器验证（新编译 ${compiled}，缓存 ${fromCache}）`);
console.log(`  assets/data.js ${kb('assets/data.js')} · dist/swift-club.html ${kb('dist/swift-club.html')}`);
console.log(`  编译器：${data.meta.compiler}`);
process.exit(problems.length ? 1 : 0);
