#!/usr/bin/env node
// Swift Club build script
//
//   content/<lang>/*.md  ──parse──▶  every Swift code block is really compiled / run by the local swiftc
//                        ──emit───▶  assets/data.<lang>.js   (one data bundle per language)
//                                    index.html              (open it locally, no server needed)
//                                    dist/swift-club.html    (single file with every language inlined)
//
// Languages are registered in content/languages.json. The default language (English) is loaded
// eagerly by index.html; the others are fetched on demand. All languages must describe the same
// features, code blocks and quiz structure; the build checks that they stay in step.
//
// Usage:
//   node tools/build.mjs              compile and verify every example (cached)
//   node tools/build.mjs --fresh      ignore the cache and recompile everything
//   node tools/build.mjs --no-compile use the cache only, never call swiftc
//
// Code-block attributes (written after ```swift):
//   title="…"      block title
//   check=ok       must compile (default)
//   check=error    must fail to compile (shows the compiler's real diagnostics)
//   check=warning  must compile with at least one warning
//   check=run      compile and run, show the real output
//   check=none     not compiled (Package.swift, C headers, shell commands, …)
//   flags="…"      extra swiftc flags, default -swift-version 6
//   script         compile as top-level code in main.swift (implied by run)
//   testing        link Swift Testing / XCTest
//   expect="…"     text that must appear in the diagnostics or output
//   hl="2,5-7"     highlighted line numbers

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

// ───────────────────────── Helpers ─────────────────────────

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

// ───────────────────────── Compiler environment ─────────────────────────

const compilerVersion = NO_COMPILE ? '' : run('swiftc', ['--version']).out.trim() || run('swiftc', ['--version']).err.trim();
let devDir = '';
try { devDir = run('xcode-select', ['-p']).out.trim(); } catch { /* not macOS */ }
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
// The cache key includes the full compiler version. With --no-compile we reuse the version recorded
// in the cache so that entries still match.
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

/** Compile (and optionally run) a piece of Swift code and return the real result. */
function compile({ code, flags, mode, script, testing, prelude }) {
  const key = sha(JSON.stringify({ code, flags, mode, script, testing, prelude, v: keyVersion }));
  if (!FRESH && cache[key]) {
    // Entries written before the site went bilingual carry a Chinese note; make them language-neutral.
    if (cache[key].command) cache[key].command = cache[key].command.replace('（链接 Swift Testing）', '{testing}');
    usedCache[key] = cache[key]; fromCache++; return cache[key];
  }
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
  result.command = ['swiftc', ...userFlags, ...(testing ? ['{testing}'] : []), mode === 'run' ? 'main.swift && ./main' : 'main.swift'].join(' ');
  fs.rmSync(dir, { recursive: true, force: true });
  cache[key] = result; usedCache[key] = result; compiled++;
  return result;
}

// ───────────────────────── Inline Markdown ─────────────────────────

const evo = JSON.parse(read('tools/evolution-snapshot.json'));
// `proposals` (6.0 and later) feed the proposal index; `earlier` holds the few pre-6.0 proposals that
// lessons cite (the 5.x prelude zone, for example), so that their links and titles resolve too.
const proposalById = new Map([...(evo.earlier || []), ...evo.proposals].map((p) => [p.id, p]));
const proposalUrl = (id) => {
  const p = proposalById.get(id);
  return p ? `https://github.com/swiftlang/swift-evolution/blob/main/proposals/${p.link}` : `https://github.com/swiftlang/swift-evolution`;
};

function inline(md, slots = []) {   // `slots` is shared with the recursive call for link text
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = md;
  // ``code`` and `code`
  s = s.replace(/``\s?([\s\S]+?)\s?``|`([^`\n]+)`/g, (_, a, b) => keep(`<code>${esc(a ?? b)}</code>`));
  // [text](link)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    const ext = /^https?:/.test(u);
    return keep(`<a href="${esc(u)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${inline(t, slots)}</a>`);
  });
  // SE-0461 → proposal link
  s = s.replace(/\bSE-(\d{4})\b/g, (m) => keep(`<a class="se-link" href="${proposalUrl(m)}" target="_blank" rel="noopener">${m}</a>`));
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i]);
  return s;
}

// ───────────────────────── Block parsing ─────────────────────────

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
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells.map((x) => inline(x)));
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
      blocks.push({ type: 'list', items: items.map((x) => inline(x)) });
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
      blocks.push({ type: 'olist', items: items.map((x) => inline(x)) });
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
  if (attrs.prelude && prelude === undefined) problems.push(`${ctx.where}: prelude "${attrs.prelude}" not found`);
  const r = compile({ code, flags, mode, script: !!attrs.script, testing: !!attrs.testing, prelude });
  block.flags = flags;
  block.result = r;
  const where = `${ctx.where} › ${attrs.title || 'code block'}`;
  const text = r.diagnostics + '\n' + r.output;
  if (r.status === 'skipped') return block;
  if (check === 'ok' && r.status !== 'ok') problems.push(`${where}: expected it to compile, got ${r.status}\n${r.diagnostics}`);
  if (check === 'error' && r.status !== 'error') problems.push(`${where}: expected an error, got ${r.status}`);
  if (check === 'warning' && r.status !== 'warning') problems.push(`${where}: expected a warning, got ${r.status}\n${r.diagnostics}`);
  if (check === 'run' && !['ok', 'warning'].includes(r.status)) problems.push(`${where}: run failed (${r.status})\n${r.diagnostics}\n${r.output}`);
  if (check === 'run' && r.status === 'warning' && !attrs.warn) problems.push(`${where}: the example produced warnings\n${r.diagnostics}`);
  if (attrs.expect && !text.includes(attrs.expect)) problems.push(`${where}: "${attrs.expect}" not found in the output\n${text}`);
  if (/are not allowed at the top level/.test(r.diagnostics)) problems.push(`${where}: top-level statements need the script attribute, otherwise the error shown is not the intended one`);
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
  if (q.answer < 0) problems.push(`${ctx.where}: quiz has no correct answer (mark it with a leading +)`);
  return q;
}

// ───────────────────────── Languages ─────────────────────────

const registry = JSON.parse(read('content/languages.json'));
const DEFAULT_LANG = registry.default;
const LANGUAGES = registry.languages;
if (!LANGUAGES.some((l) => l.code === DEFAULT_LANG)) throw new Error(`content/languages.json: default language "${DEFAULT_LANG}" is not listed`);
const defaultFirst = [...LANGUAGES].sort((a, b) => (b.code === DEFAULT_LANG) - (a.code === DEFAULT_LANG));

const guessLine = (t) => {
  if (/package|swiftpm|sbom|registry|template|coverage|build performance|plugin command|mirrors|testable|traits|cross-compilation|sdk/i.test(t)) return 6;
  if (/warning|diagnos|migration|language mode|language version|debugdescription|backtrace|demangle|test/i.test(t)) return 6;
  if (/task|actor|isolat|sendable|async|concurren|executor|continuation|deinit|observation|disconnected|deadline|cancel/i.test(t)) return 1;
  if (/span|copyable|escapable|inline|memory|unsafe|lifetime|abi|specializ|borrow|yield|bitwise|allocation|uniquebox|uniquearray|ref\b|section|consum|atomic|mutex|lock/i.test(t)) return 2;
  if (/objective-c|\bc\b|c\+\+|java|wasm|cdecl|interop|module selector|implementation/i.test(t)) return 5;
  if (/string|collection|dictionary|array|integer|duration|clock|hashable|regex|filepath|reduce|count|result|unicode|identical|float|utf8/i.test(t)) return 4;
  return 3;
};

/** Parse everything under content/<code>/ into one data bundle. */
function buildLanguage(language) {
  const dir = `content/${language.code}`;
  const tag = `[${language.code}]`;
  const site = JSON.parse(read(`${dir}/site.json`));
  const ui = JSON.parse(read(`${dir}/ui.json`));
  const releases = [];
  const features = [];

  if (site.releases.filter((r) => r.prelude).length > 1) problems.push(`${tag} site.json: only one release entry may be the prelude zone`);
  for (const { file, prelude: isPreludeZone } of site.releases) {   // (not to be confused with a code block's `prelude` support file)
    const src = read(`${dir}/${file}`);
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(src);
    if (!fm) throw new Error(`${dir}/${file}: missing frontmatter`);
    const [rmeta] = parseHeader(fm[1].split('\n'), 0);
    const rest = src.slice(fm[0].length);
    const preludes = {};
    const parts = rest.split(/^## /m).slice(1);
    const rel = {
      version: rmeta.version, id: 'v' + rmeta.version.replace(/\./g, ''), date: rmeta.date, title: rmeta.title,
      subtitle: rmeta.subtitle || '', summary: inline(rmeta.summary || ''), blog: rmeta.blog || '', features: [],
    };
    // The prelude zone (5.x basics) sits on the map before 6.0 but isn't a release: its stations
    // aren't counted as new features.
    if (isPreludeZone) rel.prelude = true;
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
      const ctx = { where: `${tag} ${file} › ${id}`, preludes };
      const se = (meta.se || '').split(/[,\s]+/).filter(Boolean).map((x) => (/^\d+$/.test(x) ? `SE-${x.padStart(4, '0')}` : x));
      const f = {
        id, release: rel.version, since: meta.since || rel.version, title: inline(meta.title || id), plainTitle: (meta.title || id).replace(/`/g, ''),
        en: meta.en || '', line: +meta.line || 3, level: meta.level || 'key', short: meta.short || meta.title,
        tags: meta.tags || '', tldr: inline(meta.tldr || ''), flag: meta.flag || '',
        se: se.map((x) => ({ id: x, url: x.startsWith('SE-') ? proposalUrl(x) : (meta[`url-${x}`] || ''), title: proposalById.get(x)?.title || '' })),
        links: (meta.links || '').split('\n').filter(Boolean).map((l) => { const m = /^(.*?)\s*\|\s*(\S+)$/.exec(l); return m ? { text: m[1], url: m[2] } : null; }).filter(Boolean),
        blocks: parseBody(lines.slice(after), ctx),
      };
      if (!site.lines.some((l) => l.id === f.line)) problems.push(`${ctx.where}: unknown line ${meta.line}`);
      if (features.some((x) => x.id === id)) problems.push(`${ctx.where}: duplicate feature id`);
      features.push(f);
      rel.features.push(id);
    }
    releases.push(rel);
  }
  for (const r of site.routes) {
    if (r.warmup && !releases.some((rel) => rel.prelude && rel.version === r.warmup)) problems.push(`${tag} site.json › route ${r.id}: warmup "${r.warmup}" is not a prelude zone`);
  }

  // ───────────── Guess the Compiler ─────────────
  const challenges = [];
  {
    const src = read(`${dir}/challenges.md`);
    for (const part of src.split(/^## /m).slice(1)) {
      const lines = part.split('\n');
      const id = lines[0].trim();
      const [meta, after] = parseHeader(lines, 1);
      const body = lines.slice(after).join('\n');
      const m = /```swift([^\n]*)\n([\s\S]*?)\n```/.exec(body);
      if (!m) { problems.push(`${tag} challenges › ${id}: missing code`); continue; }
      const attrs = parseAttrs(m[1]);
      const code = m[2];
      const r = compile({ code, flags: meta.flags || DEFAULT_FLAGS, mode: 'check', script: !!attrs.script });
      const actual = r.status;
      if (actual !== 'skipped' && meta.expect && meta.expect !== actual) problems.push(`${tag} challenges › ${id}: expected ${meta.expect}, the compiler gave ${actual}\n${r.diagnostics}`);
      challenges.push({ id, title: inline(meta.title || ''), topic: meta.topic || '', related: meta.related || '', flags: meta.flags || DEFAULT_FLAGS, code, answer: actual, diagnostics: r.diagnostics, explain: inline(meta.explain || '') });
    }
  }

  // ───────────── Labs ─────────────
  const labs = {};
  {
    const src = read(`${dir}/labs.md`);
    for (const part of src.split(/^## /m).slice(1)) {
      const lines = part.split('\n');
      const id = lines[0].trim();
      const [meta, after] = parseHeader(lines, 1);
      const body = lines.slice(after).join('\n');
      const m = /```swift([^\n]*)\n([\s\S]*?)\n```/.exec(body);
      const entry = { id, title: inline(meta.title || ''), note: inline(meta.note || ''), cmp: inline(meta.cmp || ''), flags: meta.flags || DEFAULT_FLAGS };
      if (m) {
        const attrs = parseAttrs(m[1]);
        const mode = attrs.check === 'run' ? 'run' : 'check';
        entry.code = m[2];
        entry.result = compile({ code: m[2], flags: entry.flags, mode, script: !!attrs.script });
        if (entry.result.status !== 'skipped' && meta.expect && meta.expect !== entry.result.status) problems.push(`${tag} labs › ${id}: expected ${meta.expect}, got ${entry.result.status}\n${entry.result.diagnostics}`);
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
      try { labs['memory-table'].table = JSON.parse(labs['memory-table'].result.output); } catch (e) { problems.push(`${tag} labs › memory-table: the output is not JSON`); }
    }
  }

  // ───────────── Proposal index ─────────────
  const featureBySE = new Map();
  for (const f of features) for (const s of f.se) if (!featureBySE.has(s.id)) featureBySE.set(s.id, f);
  const proposals = evo.proposals.map((p) => {
    const f = featureBySE.get(p.id);
    return { id: p.id, title: p.title, state: p.state, version: p.version, url: proposalUrl(p.id), flag: p.flag, line: f ? f.line : guessLine(p.title), feature: f ? f.id : '' };
  });

  const verified = features.flatMap((f) => f.blocks).filter((b) => b.type === 'code' && b.result && b.result.status !== 'skipped').length
    + challenges.length + Object.values(labs).filter((l) => l.result).length;
  const meta = {
    compiler: (compilerVersion.split('\n')[0] || cache.__compiler || '').trim(),
    builtAt: new Date().toISOString().slice(0, 10),
    verified,
    evolutionDate: (evo.creationDate || '').slice(0, 10),
  };
  if (!meta.compiler && cache.__compiler) meta.compiler = cache.__compiler;

  return {
    lang: language.code,
    htmlLang: language.htmlLang,
    defaultLang: DEFAULT_LANG,
    languages: LANGUAGES.map(({ code, name, short, htmlLang }) => ({ code, name, short, htmlLang })),
    ui, meta,
    lines: site.lines, routes: site.routes, releaseInfo: site.releases,
    releases, features, challenges, labs, proposals,
  };
}

// ───────────────────────── Consistency between languages ─────────────────────────

const verdict = (status) => (status === 'skipped' ? '' : status ?? '');
const blockSig = (b) => {
  switch (b.type) {
    case 'code': return `code:${b.lang}:${b.check}:${b.flags ?? ''}:${verdict(b.result?.status)}`;
    case 'quiz': return `quiz:${b.options.length}:${b.answer}`;
    case 'list': case 'olist': return `${b.type}:${b.items.length}`;
    case 'table': return `table:${b.head.length}x${b.rows.length}`;
    case 'callout': return `callout:${b.kind}[${b.blocks.map(blockSig).join(',')}]`;
    default: return b.type;
  }
};

/** A language-independent fingerprint of everything that must not differ between languages. */
function skeleton(bundle) {
  const sig = new Map();
  for (const r of bundle.releases) sig.set(`release ${r.version}`, [r.version, r.date, r.blog, r.features.join(',')].join('|'));
  for (const f of bundle.features) {
    sig.set(`feature ${f.id}`, [f.release, f.since, f.line, f.level, f.flag, f.se.map((s) => s.id).join(','), f.blocks.map(blockSig).join(' ')].join('|'));
  }
  for (const c of bundle.challenges) sig.set(`challenge ${c.id}`, [c.related, c.flags, verdict(c.answer)].join('|'));
  for (const [id, l] of Object.entries(bundle.labs)) sig.set(`lab ${id}`, [l.flags, verdict(l.result?.status), (l.steps || []).map((s) => `${s.lane}:${s.mark}`).join(',')].join('|'));
  for (const l of bundle.lines) sig.set(`line ${l.id}`, '');
  for (const r of bundle.routes) sig.set(`route ${r.id}`, `${r.stops.join(',')}|${r.warmup || ''}`);
  sig.set('releases', bundle.releaseInfo.map((r) => `${r.version}:${r.file}${r.prelude ? ':prelude' : ''}`).join(','));
  return sig;
}

const baseKey = (k) => k.replace(/_(zero|one|two|few|many|other)$/, '');

function checkParity(base, other) {
  const a = skeleton(base), b = skeleton(other);
  const tag = `[${other.lang}]`;
  for (const [k, v] of a) {
    if (!b.has(k)) problems.push(`${tag} missing ${k} (present in ${base.lang})`);
    else if (b.get(k) !== v) problems.push(`${tag} ${k} differs from ${base.lang}:\n    ${base.lang}: ${v}\n    ${other.lang}: ${b.get(k)}`);
  }
  for (const k of b.keys()) if (!a.has(k)) problems.push(`${tag} has ${k}, which ${base.lang} does not`);
  const ka = new Set(Object.keys(base.ui).map(baseKey)), kb = new Set(Object.keys(other.ui).map(baseKey));
  for (const k of ka) if (!kb.has(k)) problems.push(`${tag} ui.json is missing "${k}"`);
  for (const k of kb) if (!ka.has(k)) problems.push(`${tag} ui.json has "${k}", which ${base.lang} does not`);
}

const CJK = /[　-〿㐀-䶿一-鿿＀-￯]/;

/** Languages that are not flagged "cjk" must not contain any CJK characters (a missed translation). */
function checkNoCjk(bundle, language) {
  if (language.cjk) return;
  const tag = `[${bundle.lang}]`;
  const scan = (label, value) => { const s = JSON.stringify(value); const m = CJK.exec(s); if (m) problems.push(`${tag} ${label}: untranslated text near "${s.slice(Math.max(0, m.index - 24), m.index + 24)}"`); };
  for (const [k, v] of Object.entries(bundle.ui)) scan(`ui.json "${k}"`, v);
  for (const l of bundle.lines) scan(`line ${l.id}`, l);
  for (const r of bundle.routes) scan(`route ${r.id}`, r);
  for (const r of bundle.releases) scan(`release ${r.version}`, { ...r, features: undefined });
  for (const f of bundle.features) scan(`feature ${f.id}`, f);
  for (const c of bundle.challenges) scan(`challenge ${c.id}`, c);
  for (const [id, l] of Object.entries(bundle.labs)) scan(`lab ${id}`, l);
}

/** Every UI key the page code asks for must exist, and keys nobody uses are reported. */
function lintUi(bundle) {
  const app = read('assets/app.js');
  const page = read('src/page.html');
  const keys = new Set(Object.keys(bundle.ui).map(baseKey));
  const asked = new Set();
  for (const m of app.matchAll(/'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)'/g)) asked.add(m[1]);
  for (const m of page.matchAll(/data-i18n(?:-\w+)?="([\w.]+)"/g)) asked.add(m[1]);
  const groups = new Set([...keys].map((k) => k.split('.')[0]));
  for (const k of asked) if (!keys.has(k) && groups.has(k.split('.')[0])) problems.push(`app.js/page.html uses ui key "${k}", which ui.json does not define`);
  const unused = [...keys].filter((k) => {
    if (app.includes(`'${k}'`) || page.includes(`"${k}"`)) return false;
    const prefix = k.slice(0, k.lastIndexOf('.') + 1);
    return !(prefix && (app.includes(`'${prefix}'`) || app.includes('`' + prefix + '${')));
  });
  if (unused.length) console.warn(`  note: ui.json keys that nothing refers to: ${unused.join(', ')}`);
}

// ───────────────────────── Build ─────────────────────────

const bundles = defaultFirst.map((language) => buildLanguage(language));
const baseBundle = bundles[0];
for (const [i, bundle] of bundles.entries()) {
  checkNoCjk(bundle, defaultFirst[i]);
  if (i > 0) checkParity(baseBundle, bundle);
}
lintUi(baseBundle);

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const p of problems) console.error('• ' + p + '\n');
}

usedCache.__compiler = baseBundle.meta.compiler;
usedCache.__compilerFull = keyVersion;
// With --no-compile nothing was compiled; don't rewrite the cache or entries that were not hit would be dropped.
if (!NO_COMPILE) fs.writeFileSync(CACHE_FILE, JSON.stringify(usedCache));

// Data bundles. Stale ones (a removed language, or the old single data.js) are deleted.
const dataFiles = new Set(bundles.map((b) => `data.${b.lang}.js`));
for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) {
  if (/^data(\..+)?\.js$/.test(f) && !dataFiles.has(f)) fs.rmSync(path.join(ROOT, 'assets', f));
}
const jsonOf = (b) => JSON.stringify(b).replace(/</g, '\\u003c');
for (const b of bundles) {
  write(`assets/data.${b.lang}.js`, `/* Generated by tools/build.mjs; do not edit by hand */\nwindow.SWIFT_CLUB_DATA = window.SWIFT_CLUB_DATA || {};\nwindow.SWIFT_CLUB_DATA[${JSON.stringify(b.lang)}] = ${jsonOf(b)};\n`);
}

// Pages: the local version (a full document) and the single-file version for publishing
const page = read('src/page.html');
const [headPart, bodyPart] = page.split('<!-- BODY -->');
const css = read('assets/style.css');
const app = read('assets/app.js');
const defaultLanguage = LANGUAGES.find((l) => l.code === DEFAULT_LANG);
const ICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%23f05138'/%3E%3Cpath d='M8.5 21 L14.5 14.5 H23.5' fill='none' stroke='%23fff' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='8.5' cy='21' r='3.3' fill='%23fff'/%3E%3Ccircle cx='23.5' cy='14.5' r='3.3' fill='%23fff'/%3E%3C/svg%3E">`;
write('index.html', `<!doctype html>
<html lang="${defaultLanguage.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${headPart.trim()}
${ICON}
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
${bodyPart.trim()}
<script src="assets/data.${DEFAULT_LANG}.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
`);
write('dist/swift-club.html', `${headPart.trim()}
<style>
${css}
</style>
${bodyPart.trim()}
<script>window.SWIFT_CLUB_DATA = {${bundles.map((b) => `${JSON.stringify(b.lang)}: ${jsonOf(b)}`).join(',\n')}};</script>
<script>
${app.replace(/<\/script/gi, '<\\/script')}
</script>
`);

const kb = (p) => (fs.statSync(path.join(ROOT, p)).size / 1024).toFixed(0) + ' KB';
for (const b of bundles) {
  const prelude = b.releases.filter((r) => r.prelude);
  const basics = prelude.reduce((n, r) => n + r.features.length, 0);
  const zones = `${b.releases.length - prelude.length} releases${prelude.length ? ` + ${prelude.map((r) => r.version).join(', ')} prelude` : ''}`;
  console.log(`✓ [${b.lang}] ${zones} · ${b.features.length - basics} features${basics ? ` + ${basics} basics` : ''} · ${b.challenges.length} challenges · ${b.meta.verified} code blocks verified by the compiler · assets/data.${b.lang}.js ${kb(`assets/data.${b.lang}.js`)}`);
}
console.log(`  compiled ${compiled} new, ${fromCache} from cache · dist/swift-club.html ${kb('dist/swift-club.html')}`);
console.log(`  compiler: ${baseBundle.meta.compiler}`);
process.exit(problems.length ? 1 : 0);
