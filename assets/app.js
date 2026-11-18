/* Swift Club · 进化线路图 —— 页面逻辑（无依赖） */
(() => {
  'use strict';

  const D = window.SWIFT_CLUB;
  const main = document.getElementById('main');
  if (!D) {
    main.innerHTML = '<div class="wrap page-head"><h1>还没有数据</h1><p>请先在项目目录运行 <code>node tools/build.mjs</code> 生成 <code>assets/data.js</code>。</p></div>';
    return;
  }

  // ───────────────────────── 工具 ─────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.textContent;
  };
  const fmtDate = (d) => d.replace(/-/g, '.');

  const LINES = new Map(D.lines.map((l) => [l.id, l]));
  const FEATURES = D.features;
  const FMAP = new Map(FEATURES.map((f) => [f.id, f]));
  const RELEASES = D.releases;
  const RMAP = new Map(RELEASES.map((r) => [r.id, r]));
  const relOf = (f) => RELEASES.find((r) => r.version === f.release);
  const ORDER = RELEASES.flatMap((r) => r.features);
  const LEVEL = { core: '核心', key: '重点', brief: '速览' };

  // ───────────────────────── 本地存储（仅本浏览器） ─────────────────────────
  const store = {
    get(k, d) { try { const v = localStorage.getItem('swiftclub:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('swiftclub:' + k, JSON.stringify(v)); } catch { /* 隐私模式等情况 */ } },
  };
  let learned = new Set(store.get('learned', []).filter((id) => FMAP.has(id)));
  let firstRide = store.get('first', null);
  if (!firstRide) { firstRide = new Date().toISOString().slice(0, 10); store.set('first', firstRide); }

  function setLearned(id, on) {
    if (on) learned.add(id); else learned.delete(id);
    store.set('learned', [...learned]);
    $$(`[data-punch="${id}"]`).forEach((b) => paintPunch(b, on));
    $$(`.strip li[data-id="${id}"]`).forEach((li) => li.classList.toggle('done', on));
    if (on) toast(`已打卡：${FMAP.get(id).plainTitle}`);
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ───────────────────────── Swift 语法高亮 ─────────────────────────
  const KW = new Set(('associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private ' +
    'precedencegroup protocol public rethrows static struct subscript typealias var break case catch continue default defer do else ' +
    'fallthrough for guard if in repeat return throw switch where while as false is nil self Self super throws true try await async ' +
    'actor nonisolated isolated some any consuming borrowing consume copy discard each sending mutating nonmutating lazy weak unowned ' +
    'final override required convenience indirect get set willSet didSet package macro unsafe borrow mutate yield ' +
    'yielding throws rethrows').split(' '));
  const DECL_AFTER = new Set(['func', 'struct', 'class', 'enum', 'protocol', 'actor', 'typealias', 'associatedtype', 'macro']);
  const reIdent = /[\p{L}_][\p{L}\p{N}_]*/uy;
  const reNum = /(?:0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/y;

  function tokenizeSwift(src) {
    const out = [];
    let i = 0;
    let prevWord = '';
    let prevSig = '';
    const n = src.length;
    const push = (cls, v) => { if (v) out.push([cls, v]); };
    while (i < n) {
      const ch = src[i];
      if (ch === '/' && src[i + 1] === '/') {
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        push('c', src.slice(i, j));
        i = j;
        continue;
      }
      if (ch === '/' && src[i + 1] === '*') {
        let depth = 1, j = i + 2;
        while (j < n && depth) {
          if (src.startsWith('/*', j)) { depth++; j += 2; } else if (src.startsWith('*/', j)) { depth--; j += 2; } else j++;
        }
        push('c', src.slice(i, j));
        i = j;
        continue;
      }
      if (ch === '"' || (ch === '#' && /^#+"/.test(src.slice(i, i + 6)))) {
        i = scanString(src, i, out);
        prevSig = 'str'; prevWord = '';
        continue;
      }
      if (/\d/.test(ch) && !/[\p{L}\p{N}_]/u.test(src[i - 1] || '')) {
        reNum.lastIndex = i;
        const m = reNum.exec(src);
        if (m) { push('n', m[0]); i += m[0].length; prevSig = 'num'; prevWord = ''; continue; }
      }
      if (ch === '@' && /[A-Za-z_]/.test(src[i + 1] || '')) {
        reIdent.lastIndex = i + 1;
        const m = reIdent.exec(src);
        push('a', '@' + m[0]);
        i += m[0].length + 1;
        prevSig = 'attr';
        continue;
      }
      if (ch === '#' && /[A-Za-z_]/.test(src[i + 1] || '')) {
        reIdent.lastIndex = i + 1;
        const m = reIdent.exec(src);
        push('p', '#' + m[0]);
        i += m[0].length + 1;
        prevSig = 'pound';
        continue;
      }
      if (ch === '`') {
        const j = src.indexOf('`', i + 1);
        const nl = src.indexOf('\n', i + 1);
        if (j > i && (nl < 0 || j < nl)) {
          const v = src.slice(i, j + 1);
          const cls = DECL_AFTER.has(prevWord) ? 'd' : src[j + 1] === '(' ? 'f' : null;
          push(cls, v);
          i = j + 1;
          prevWord = ''; prevSig = 'ident';
          continue;
        }
      }
      if (/[\p{L}_]/u.test(ch)) {
        reIdent.lastIndex = i;
        const m = reIdent.exec(src);
        const w = m[0];
        let cls = null;
        if (DECL_AFTER.has(prevWord)) cls = 'd';
        else if (KW.has(w) && src[i - 1] !== '.' && prevWord !== 'let' && prevWord !== 'var') cls = 'k';
        else if (w === 'of' && prevSig === 'num') cls = 'k';
        else if (/^[A-Z]/.test(w)) cls = 't';
        else if (src[i + w.length] === '(') cls = 'f';
        push(cls, w);
        i += w.length;
        prevWord = KW.has(w) ? w : '';
        prevSig = 'ident';
        continue;
      }
      push(null, ch);
      if (!/\s/.test(ch)) { prevSig = ch; if (ch !== '<' && ch !== '>') prevWord = ''; }
      i++;
    }
    return out;
  }

  function skipString(src, k) {
    let j = k + 1;
    while (j < src.length && src[j] !== '"' && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
    return j + 1;
  }

  function scanString(src, i, out) {
    const n = src.length;
    let j = i, hashes = 0;
    while (src[j] === '#') { hashes++; j++; }
    const multi = src.startsWith('"""', j);
    const quote = multi ? '"""' : '"';
    const closer = quote + '#'.repeat(hashes);
    const escSeq = '\\' + '#'.repeat(hashes);
    j += quote.length;
    let seg = i;
    while (j < n) {
      if (src.startsWith(closer, j)) { j += closer.length; out.push(['s', src.slice(seg, j)]); return j; }
      if (!multi && src[j] === '\n') { out.push(['s', src.slice(seg, j)]); return j; }
      if (src.startsWith(escSeq, j)) {
        const after = j + escSeq.length;
        if (src[after] === '(') {
          out.push(['s', src.slice(seg, after + 1)]);
          let depth = 1, k = after + 1;
          while (k < n && depth) {
            const c = src[k];
            if (c === '"') { k = skipString(src, k); continue; }
            if (c === '(') depth++;
            else if (c === ')') { depth--; if (!depth) break; }
            k++;
          }
          for (const tk of tokenizeSwift(src.slice(after + 1, k))) out.push(tk);
          out.push(['s', ')']);
          j = k + 1;
          seg = j;
          continue;
        }
        j = after + 1;
        continue;
      }
      j++;
    }
    out.push(['s', src.slice(seg, j)]);
    return j;
  }

  function tokenizeOther(src, lang) {
    const out = [];
    const kw = lang === 'shell'
      ? /^(swift|swiftc|build|package|test|migrate|sdk|install|show-traits)$/
      : /^(void|int|double|float|char|unsigned|typedef|enum|struct|return|const|static|if|else|interface|end|implementation|property|nonatomic|strong|SWIFT_EXTERN|SWIFT_ENUM|SWIFT_NOEXCEPT|SWIFT_WARN_UNUSED_RESULT)$/;
    const re = lang === 'shell'
      ? /(#.*$)|("[^"\n]*"|'[^'\n]*')|(\b\d+\b)|(--?[\w-]+)|([\w.-]+)|([\s\S])/gm
      : /(\/\/.*$|\/\*[\s\S]*?\*\/)|("[^"\n]*")|(\b\d+\b)|(@\w+|#\w+)|([A-Za-z_]\w*)|([\s\S])/gm;
    let m;
    while ((m = re.exec(src))) {
      if (m[1]) out.push(['c', m[1]]);
      else if (m[2]) out.push(['s', m[2]]);
      else if (m[3]) out.push(['n', m[3]]);
      else if (m[4]) out.push([lang === 'shell' ? 'a' : 'k', m[4]]);
      else if (m[5]) out.push([kw.test(m[5]) ? 'k' : /^[A-Z]/.test(m[5]) && lang !== 'shell' ? 't' : null, m[5]]);
      else out.push([null, m[6]]);
    }
    return out;
  }

  function highlightLines(code, lang) {
    const tokens = lang === 'swift' ? tokenizeSwift(code) : lang === 'text' ? [[null, code]] : tokenizeOther(code, lang);
    const lines = [''];
    for (const [cls, v] of tokens) {
      v.split('\n').forEach((part, k) => {
        if (k > 0) lines.push('');
        if (part) lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
      });
    }
    return lines;
  }

  function parseHl(spec) {
    const set = new Set();
    for (const part of String(spec || '').split(',')) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
      if (m) for (let k = +m[1]; k <= +(m[2] || m[1]); k++) set.add(k);
    }
    return set;
  }

  // ───────────────────────── 编译器输出 ─────────────────────────
  const sevClass = (w) => (w === 'error' ? 't-err' : w === 'warning' ? 't-warn' : 't-note');

  function renderTerm(raw) {
    const docs = new Map();
    const body = [];
    for (const line of String(raw).split('\n')) {
      const m = /^\[#([\w:]+)\]: <(https?:[^>]+)>$/.exec(line.trim());
      if (m) docs.set(m[1], m[2]); else body.push(line);
    }
    while (body.length && !body[body.length - 1].trim()) body.pop();
    const group = (html) => html.replace(/\[#([\w:]+)\]/g, (s, g) => {
      const key = g.split('::').pop();
      const url = docs.get(key) || docs.get(g.split('::')[0]);
      return url ? `<a class="t-group" href="${esc(url)}" target="_blank" rel="noopener">[#${esc(g)}]</a>` : `<span class="t-group">[#${esc(g)}]</span>`;
    });
    const html = body.map((line) => {
      let m;
      if ((m = /^(\S+?:\d+:\d+): (error|warning|note|remark): (.*)$/.exec(line))) {
        return `<span class="t-loc">${esc(m[1])}:</span> <span class="${sevClass(m[2])}">${m[2]}:</span> ${group(esc(m[3]))}`;
      }
      if ((m = /^(\s*\d+\s*\|)(.*)$/.exec(line))) return `<span class="t-gut">${esc(m[1])}</span>${esc(m[2])}`;
      if ((m = /^(\s*\|)(.*)$/.exec(line))) {
        const rest = esc(m[2]).replace(/\b(error|warning|note|remark):/g, (s, w) => `<span class="${sevClass(w)}">${w}:</span>`);
        return `<span class="t-gut">${esc(m[1])}</span>${group(rest)}`;
      }
      return group(esc(line));
    }).join('\n');
    const links = [...docs].map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(k)} ↗</a>`).join('');
    return html + (links ? `<div class="term-docs"><span>诊断分组说明：</span>${links}</div>` : '');
  }

  const codeStore = new Map();
  let codeSeq = 0;

  function codeFigure(b, opts = {}) {
    const lines = highlightLines(b.code, b.lang);
    const hl = opts.hlSet || parseHl(b.hl);
    const body = lines.map((l, i) => `<span class="ln${hl.has(i + 1) ? ' hl' : ''}" data-n="${i + 1}">${l || ' '}</span>`).join('');
    const id = 'c' + ++codeSeq;
    codeStore.set(id, b.code);
    const r = opts.noResult ? null : b.result;
    let badge = '';
    if (!opts.noResult) {
      if (b.check === 'none') badge = `<span class="badge none">${b.lang === 'swift' ? '示意，未编译' : { shell: '命令行', c: 'C', objc: 'Objective-C', text: '文本' }[b.lang] || b.lang}</span>`;
      else if (!r || r.status === 'skipped') badge = '<span class="badge none">未验证</span>';
      else if (b.check === 'run') badge = r.status === 'warning' ? '<span class="badge warning">运行 · 有警告</span>' : '<span class="badge ok">已运行</span>';
      else badge = { ok: '<span class="badge ok">编译通过</span>', warning: '<span class="badge warning">有警告</span>', error: '<span class="badge error">编译错误</span>' }[r.status] || '';
    }
    const title = b.title || (b.file ? `<span class="code-file">${esc(b.file)}</span>` : '');
    let tail = '';
    if (r && r.status !== 'skipped') {
      tail += `<div class="code-cmd">$ ${esc(r.command || 'swiftc main.swift')}</div>`;
      if (r.diagnostics) tail += `<pre class="term">${renderTerm(r.diagnostics)}</pre>`;
      else if (b.check !== 'run') tail += '<pre class="term"><span class="t-ok">✓ 没有错误，也没有警告</span></pre>';
      if (b.check === 'run') tail += `<pre class="term"><span class="term-label">运行输出</span>${esc(r.output || '（无输出）')}</pre>`;
    }
    return `<figure class="code${opts.nolines ? ' nolines' : ''}${opts.bare ? ' bare' : ''}"${opts.attrs || ''}>
      <figcaption class="code-head"><span class="code-title">${title}</span>${badge}<button class="copy-btn" type="button" data-copy="${id}">复制</button></figcaption>
      <pre class="src"><code>${body}</code></pre>${tail}</figure>`;
  }

  // ───────────────────────── 内容块 ─────────────────────────
  const quizStore = new Map();

  function renderBlock(b, key) {
    switch (b.type) {
      case 'p': return `<p>${b.html}</p>`;
      case 'h': return `<h4>${b.html}</h4>`;
      case 'list': return `<ul>${b.items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
      case 'olist': return `<ol>${b.items.map((x) => `<li>${x}</li>`).join('')}</ol>`;
      case 'table': return `<div class="table-wrap"><table><thead><tr>${b.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      case 'callout': return `<div class="callout">${b.title ? `<b>${b.title}</b>` : ''}${b.blocks.map((x, i) => renderBlock(x, key + '-' + i)).join('')}</div>`;
      case 'code': return codeFigure(b, { nolines: b.lang === 'shell' });
      case 'quiz': {
        quizStore.set(key, b);
        return `<div class="quiz" data-quiz="${key}">
          <div class="quiz-q"><span class="qmark">?</span><div>${b.question}</div></div>
          <div class="quiz-opts">${b.options.map((o, i) => `<button type="button" data-i="${i}"><span class="opt-key">${'ABCDEF'[i]}</span><span>${o}</span></button>`).join('')}</div>
          <div class="quiz-explain" hidden>${b.explain}</div></div>`;
      }
      default: return '';
    }
  }

  function paintPunch(btn, on) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    $('.punch-label', btn).textContent = on ? '已打卡：学会了' : '打卡：我学会了';
  }

  function punchButton(id) {
    const on = learned.has(id);
    return `<button class="punch" type="button" data-punch="${id}" aria-pressed="${on}"><span class="hole"></span><span class="punch-label">${on ? '已打卡：学会了' : '打卡：我学会了'}</span></button>`;
  }

  function seChips(f) {
    return f.se.map((s) => (s.url
      ? `<a class="chip mono" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(s.id)}</a>`
      : `<span class="chip mono">${esc(s.id)}</span>`)).join('');
  }

  function featureArticle(f) {
    const line = LINES.get(f.line);
    const pos = ORDER.indexOf(f.id);
    const prev = FMAP.get(ORDER[pos - 1]);
    const next = FMAP.get(ORDER[pos + 1]);
    const since = f.since !== f.release ? `<span class="chip">Swift ${esc(f.since)} 加入</span>` : '';
    const flag = f.flag ? `<span class="chip flag" title="通过 upcoming feature 开关启用">${esc(f.flag)}</span>` : '';
    return `<article class="feature" id="f-${f.id}" data-line="${f.line}" data-id="${f.id}">
      <div class="f-top">
        <span class="f-line"><span class="bullet sm">${f.line}</span>${esc(line.name)}</span>
        <span class="chip level-${f.level}">${LEVEL[f.level]}</span>${since}${seChips(f)}${flag}
      </div>
      <h2>${f.title}</h2>
      ${f.en ? `<div class="f-en">${esc(f.en)}</div>` : ''}
      <p class="f-tldr">${f.tldr}</p>
      <div class="f-body">${f.blocks.map((b, i) => renderBlock(b, f.id + '-' + i)).join('')}</div>
      <div class="f-foot">
        ${punchButton(f.id)}
        <div class="f-links">
          ${prev ? `<a class="chip" href="#f-${prev.id}">← ${esc(prev.short)}</a>` : ''}
          ${next ? `<a class="chip" href="#f-${next.id}">${esc(next.short)} →</a>` : ''}
        </div>
      </div>
    </article>`;
  }

  // ───────────────────────── 路由 ─────────────────────────
  let cleanup = [];
  let currentView = '';

  function setNav(key) {
    $$('#nav a').forEach((a) => {
      const on = a.dataset.key === key;
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const cur = $('#nav a[aria-current]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderNav() {
    const rel = RELEASES.map((r) => `<a href="#${r.id}" data-key="${r.id}"><span class="v">${r.version}</span></a>`).join('');
    $('#nav').innerHTML = `<a href="#map" data-key="map">线路图</a><span class="sep"></span>${rel}<span class="sep"></span>
      <a href="#labs" data-key="labs">实验室</a><a href="#quiz" data-key="quiz">猜猜看</a><a href="#index" data-key="index">提案总表</a><a href="#pass" data-key="pass">通行卡</a>`;
  }

  function route() {
    const h = decodeURIComponent(location.hash.slice(1)) || 'map';
    let target = null;
    let view = h;
    if (h.startsWith('f-') && FMAP.has(h.slice(2))) { target = h.slice(2); view = relOf(FMAP.get(target)).id; }
    if (view === currentView && target) { scrollToFeature(target); return; }
    cleanup.forEach((fn) => fn());
    cleanup = [];
    hideTip();
    currentView = view;
    if (RMAP.has(view)) { viewRelease(RMAP.get(view), target); setNav(view); return; }
    const views = { map: viewHome, labs: viewLabs, 'lab-concurrency': viewLabConcurrency, 'lab-ownership': viewLabOwnership, 'lab-memory': viewLabMemory, quiz: viewQuiz, index: viewIndex, pass: viewPass };
    (views[view] || viewHome)();
    setNav(views[view] ? (view.startsWith('lab-') ? 'labs' : view) : 'map');
    window.scrollTo(0, 0);
  }

  function scrollToFeature(id) {
    const el = document.getElementById('f-' + id);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }

  // ───────────────────────── 首页 ─────────────────────────
  function lastFeature() { const id = store.get('last', null); return FMAP.get(id) || null; }

  function viewHome() {
    const verified = D.meta.verified;
    const last = lastFeature();
    const total = FEATURES.length;
    main.innerHTML = `
    <section class="hero">
      <div class="wrap hero-grid">
        <div>
          <div class="eyebrow">Swift 6.0 → 6.4 · ${fmtDate(RELEASES[0].date).slice(0, 7)} – ${fmtDate(RELEASES[RELEASES.length - 1].date).slice(0, 7)}</div>
          <h1>Swift <span class="ver">6.0 → 6.4</span><br>两年新特性线路图</h1>
          <p class="hero-lead">六条主题线路，穿过五个版本的“票价区”。每一站是一个新特性：一句话讲清楚，新旧代码对比，附上编译器的真实输出，有的站还配一道小测。</p>
          <div class="hero-cta">
            ${last ? `<a class="btn primary" href="#f-${last.id}">继续：${esc(last.short)} →</a><a class="btn" href="#v60">从 6.0 出发</a>`
                   : `<a class="btn primary" href="#v60">从 6.0 出发 →</a>`}
            <a class="btn" href="#lab-concurrency">先玩并发实验室</a>
          </div>
        </div>
        <div>
          <div class="stats">
            <div class="stat"><b>${RELEASES.length}</b><span>个版本（6.0–6.4）</span></div>
            <div class="stat"><b>${total}</b><span>个特性站</span></div>
            <div class="stat"><b>${verified}</b><span>段代码经真实编译</span></div>
            <div class="stat"><b>${D.proposals.length}</b><span>个 Evolution 提案</span></div>
          </div>
          <p class="verify-note"><span class="dot"></span><span>页面上每一段 Swift 代码都在构建时交给 <code>swiftc</code> 真实编译或运行，报错和输出都是编译器的原样输出（${esc((/Swift version [\d.]+/.exec(D.meta.compiler) || [D.meta.compiler])[0])}）。</span></p>
        </div>
      </div>
    </section>
    <section class="map-band" aria-label="线路图">
      <div class="wrap map-tools">
        <div class="map-legend" id="legend">${D.lines.map((l) => `<button type="button" data-line="${l.id}" data-toggle="${l.id}" aria-pressed="false"><span class="bullet sm">${l.id}</span>${esc(l.name)}</button>`).join('')}</div>
        <span class="hint"><span class="hint-mouse">悬停查看简介，点击站点进入课程</span><span class="hint-touch">左右滑动看完整线路，点击站点进入课程</span> · 实心站点表示已打卡</span>
      </div>
      <div class="map-scroll" id="mapScroll"></div>
    </section>
    <section class="section">
      <div class="wrap">
        <div class="section-head"><div><div class="eyebrow">推荐路线</div><h2>三条快线</h2></div><p>不想一站一站坐？按你的目标选一条快线，只停最关键的站。</p></div>
        <div class="routes">${D.routes.map(routeCard).join('')}</div>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <div class="section-head"><div><div class="eyebrow">按版本浏览</div><h2>发车时刻表</h2></div><p>五个版本，每半年一班。点击进入该版本的全部特性。</p></div>
        <div class="board">${RELEASES.map(boardRow).join('')}</div>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <div class="section-head"><div><div class="eyebrow">动手</div><h2>实验室与小游戏</h2></div><p>有些概念看十遍不如亲手点一遍。</p></div>
        ${labCards()}
      </div>
    </section>`;
    drawMap();
    const onResize = () => drawMap();
    let rt;
    const handler = () => { clearTimeout(rt); rt = setTimeout(onResize, 150); };
    window.addEventListener('resize', handler);
    cleanup.push(() => window.removeEventListener('resize', handler));
  }

  function routeCard(r) {
    const stops = r.stops.map((id) => FMAP.get(id)).filter(Boolean);
    const done = stops.filter((f) => learned.has(f.id)).length;
    const nextStop = stops.find((f) => !learned.has(f.id)) || stops[0];
    return `<article class="route">
      <div class="route-head"><span class="route-badge">${esc(r.id)}</span><h3>${esc(r.name)}</h3></div>
      <p class="who">${esc(r.who)}</p>
      <ol class="route-stops">${stops.map((f) => `<li class="${learned.has(f.id) ? 'done' : ''}" data-line="${f.line}"><span class="stop-dot"></span><a href="#f-${f.id}">${esc(f.short)}</a><span class="stop-ver">${f.release}</span></li>`).join('')}</ol>
      <div class="route-foot"><span>${esc(r.time)} · 已完成 ${done}/${stops.length}</span><a class="btn small" href="#f-${nextStop.id}">${done ? '继续' : '出发'} →</a></div>
    </article>`;
  }

  function boardRow(r) {
    const feats = r.features.map((id) => FMAP.get(id));
    const lines = [...new Set(feats.map((f) => f.line))].sort();
    const done = feats.filter((f) => learned.has(f.id)).length;
    return `<a class="board-row" href="#${r.id}">
      <span class="board-ver">${r.version}</span>
      <span class="board-date">${fmtDate(r.date)}<span>${esc(r.subtitle)}</span></span>
      <span class="board-title"><b>${esc(r.title)}</b><span>${feats.length} 个特性 · ${lines.map((l) => `<span class="bullet sm" data-line="${l}" style="display:inline-grid;vertical-align:-3px;margin-right:2px">${l}</span>`).join('')}</span></span>
      <span class="board-prog"><span>已打卡 ${done}/${feats.length}</span><span class="meter"><i style="width:${(done / feats.length) * 100}%"></i></span></span>
      <span class="board-go" aria-hidden="true">→</span>
    </a>`;
  }

  function labCards() {
    return `<div class="lab-cards">
      <a class="lab-card" href="#lab-concurrency"><div class="lab-art">${artLanes()}</div><h3>并发执行轨迹</h3><p>一步步看清 nonisolated async 函数到底在哪个线程上执行：旧规则、nonsending 与 @concurrent。</p><span class="go">进入实验室 →</span></a>
      <a class="lab-card" href="#lab-ownership"><div class="lab-art">${artTicket()}</div><h3>所有权沙盒</h3><p>一张不能复印的车票：亲手移动、借用、消耗一个 ~Copyable 值，看编译器怎么拦你。</p><span class="go">进入实验室 →</span></a>
      <a class="lab-card" href="#lab-memory"><div class="lab-art">${artBytes()}</div><h3>内存布局</h3><p>Array、InlineArray、Span 在内存里长什么样？逐字节对比，数据来自真实运行。</p><span class="go">进入实验室 →</span></a>
      <a class="lab-card" href="#quiz"><div class="lab-art">${artQuiz()}</div><h3>编译器猜猜看</h3><p>${D.challenges.length} 段代码，猜它能不能编译。标准答案由 Swift 6.4.2 给出。</p><span class="go">开始挑战 →</span></a>
    </div>`;
  }
  const artLanes = () => `<svg width="150" height="70" viewBox="0 0 150 70" aria-hidden="true"><line x1="40" y1="8" x2="40" y2="62" stroke="var(--l1)" stroke-width="4" stroke-linecap="round"/><line x1="110" y1="8" x2="110" y2="62" stroke="var(--l2)" stroke-width="4" stroke-linecap="round"/><path d="M40 22 L110 34 L40 50" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="4 4"/><circle cx="40" cy="22" r="6" fill="var(--surface)" stroke="var(--l1)" stroke-width="3"/><circle cx="110" cy="34" r="6" fill="var(--surface)" stroke="var(--l2)" stroke-width="3"/><circle cx="40" cy="50" r="6" fill="var(--l1)"/></svg>`;
  const artTicket = () => `<svg width="150" height="70" viewBox="0 0 150 70" aria-hidden="true"><rect x="22" y="16" width="106" height="40" rx="7" fill="var(--surface)" stroke="var(--l4)" stroke-width="2.5"/><line x1="92" y1="18" x2="92" y2="54" stroke="var(--l4)" stroke-width="2" stroke-dasharray="3 3"/><text x="34" y="41" font-size="15" font-weight="800" fill="var(--ink)" font-family="Overpass, sans-serif">No.1</text><circle cx="110" cy="36" r="7" fill="var(--l4)"/></svg>`;
  const artBytes = () => { let s = '<svg width="150" height="70" viewBox="0 0 150 70" aria-hidden="true">'; for (let k = 0; k < 32; k++) { const x = 14 + (k % 16) * 7.8, y = 18 + Math.floor(k / 16) * 18; const c = k < 8 ? 'var(--ink-3)' : k < 24 ? 'var(--l2)' : 'var(--rule)'; s += `<rect x="${x}" y="${y}" width="6" height="14" rx="1.5" fill="${c}"/>`; } return s + '</svg>'; };
  const artQuiz = () => `<svg width="150" height="70" viewBox="0 0 150 70" aria-hidden="true"><circle cx="40" cy="35" r="14" fill="var(--ok-soft)"/><path d="M33 35l5 5 9-10" stroke="var(--ok)" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="75" cy="35" r="14" fill="var(--warn-soft)"/><text x="75" y="41" text-anchor="middle" font-size="17" font-weight="900" fill="var(--warn)">!</text><circle cx="110" cy="35" r="14" fill="var(--err-soft)"/><path d="M104 29l12 12M116 29l-12 12" stroke="var(--err)" stroke-width="3" stroke-linecap="round"/></svg>`;

  // ───────────── 线路图（SVG） ─────────────
  let mapCompact = null;
  let dimLine = 0;

  function drawMap() {
    const box = $('#mapScroll');
    if (!box) return;
    const compact = window.innerWidth < 720;
    if (compact === mapCompact && box.firstChild) return;
    mapCompact = compact;
    const STEP = compact ? 35 : 43, ROW = compact ? 86 : 98, TOP = compact ? 70 : 80, GUT = compact ? 150 : 186, PAD = compact ? 16 : 22;
    const grid = RELEASES.map((r) => {
      const by = {};
      for (const id of r.features) { const f = FMAP.get(id); (by[f.line] ||= []).push(f); }
      return by;
    });
    const colW = grid.map((by) => Math.max(2, ...D.lines.map((l) => (by[l.id] || []).length)) * STEP + PAD * 2);
    const colX = [];
    let x = GUT;
    for (const w of colW) { colX.push(x); x += w; }
    const W = x + (compact ? 78 : 104);
    const H = TOP + D.lines.length * ROW + 10;
    const rowY = (l) => TOP + (l - 1) * ROW + Math.round(ROW * 0.7);
    const last = store.get('last', null);
    let s = `<svg class="map-svg${dimLine ? ' dimmed' : ''}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Swift 6.0 到 6.4 特性线路图">`;
    RELEASES.forEach((r, i) => {
      if (i % 2 === 0) s += `<rect class="zone" x="${colX[i]}" y="0" width="${colW[i]}" height="${H}"/>`;
      s += `<a class="ver-link" href="#${r.id}" aria-label="Swift ${r.version}"><text class="ver-label" x="${colX[i] + PAD - 4}" y="${compact ? 30 : 36}">${r.version}</text><text class="ver-date" x="${colX[i] + PAD - 3}" y="${compact ? 48 : 56}">${fmtDate(r.date).slice(0, 7)} · ${r.features.length} 站</text></a>`;
    });
    for (const line of D.lines) {
      const y = rowY(line.id);
      s += `<g class="row${dimLine === line.id ? ' on' : ''}" data-line="${line.id}">`;
      s += `<path class="track" d="M${GUT - 14} ${y} H${W - 34}" stroke="var(--l${line.id})"/>`;
      s += `<g class="line-group" data-toggle="${line.id}" tabindex="0" role="button" aria-label="只看${esc(line.name)}">
        <circle cx="${compact ? 18 : 24}" cy="${y - 7}" r="${compact ? 11 : 13}" fill="var(--l${line.id})"/>
        <text class="line-num" x="${compact ? 18 : 24}" y="${y - 2}" text-anchor="middle" fill="var(--l${line.id}-on)">${line.id}</text>
        <text class="line-name" x="${compact ? 34 : 44}" y="${y - 3}"${compact ? ' style="font-size:12.5px"' : ''}>${esc(line.name)}</text>
        ${compact ? '' : `<text class="line-en" x="44" y="${y + 14}">${esc(line.en)}</text>`}
      </g>`;
      RELEASES.forEach((r, i) => {
        const list = grid[i][line.id] || [];
        const inner = colW[i] - PAD * 2;
        list.forEach((f, k) => {
          const sx = Math.round(colX[i] + PAD + (k + 0.5) * (inner / list.length));
          const rad = f.level === 'core' ? 8.5 : f.level === 'brief' ? 5.8 : 7.2;
          s += `<a class="station ${f.level}${learned.has(f.id) ? ' done' : ''}" href="#f-${f.id}" data-id="${f.id}" style="--c: var(--l${line.id})">
            <title>${esc(f.plainTitle)}</title>
            <circle cx="${sx}" cy="${y}" r="${rad}" stroke="var(--l${line.id})"/>
            <text class="label" transform="translate(${sx + 3} ${y - rad - 7}) rotate(-38)">${esc(f.short)}</text>
          </a>`;
          if (f.id === last) {
            s += `<g aria-hidden="true"><rect class="here-bg" x="${sx - 30}" y="${y + 13}" width="60" height="18" rx="9"/><text class="here" x="${sx}" y="${y + 26}" text-anchor="middle">上次到这</text></g>`;
          }
        });
      });
      s += '</g>';
    }
    s += '</svg>';
    box.innerHTML = s;
  }

  function toggleLine(id) {
    dimLine = dimLine === id ? 0 : id;
    const svg = $('.map-svg');
    if (svg) {
      svg.classList.toggle('dimmed', !!dimLine);
      $$('.row', svg).forEach((g) => g.classList.toggle('on', +g.dataset.line === dimLine));
    }
    $$('#legend button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.toggle === dimLine)));
  }

  function showTip(f, x, y) {
    const tip = $('#tip');
    const line = LINES.get(f.line);
    tip.innerHTML = `<div class="tip-head"><span class="bullet sm" data-line="${f.line}">${f.line}</span>${esc(line.name)} · Swift ${esc(f.since)} · ${LEVEL[f.level]}</div><b>${esc(f.plainTitle)}</b><p>${esc(text(f.tldr))}</p>`;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 16, top = y + 16;
    if (left + w > window.innerWidth - 12) left = x - w - 16;
    if (top + h > window.innerHeight - 12) top = y - h - 16;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { const t = $('#tip'); if (t) t.hidden = true; }

  // ───────────────────────── 版本页 ─────────────────────────
  function viewRelease(rel, focusId) {
    const feats = rel.features.map((id) => FMAP.get(id));
    const byLine = {};
    feats.forEach((f) => { byLine[f.line] = (byLine[f.line] || 0) + 1; });
    const idx = RELEASES.indexOf(rel);
    const next = RELEASES[idx + 1];
    main.innerHTML = `
      <section class="rel-head">
        <div class="wrap rel-head-grid">
          <div class="rel-ver">${rel.version}<small>${esc(rel.subtitle)}</small></div>
          <div class="rel-meta">
            <div class="eyebrow">Swift ${rel.version} · ${fmtDate(rel.date)} 发布 · ${feats.length} 个特性</div>
            <h1>${esc(rel.title)}</h1>
            <p class="summary">${rel.summary}</p>
            <div class="rel-facts">
              ${Object.keys(byLine).sort().map((l) => `<span class="chip" data-line="${l}"><span class="bullet sm">${l}</span>${esc(LINES.get(+l).name)} ${byLine[l]}</span>`).join('')}
              ${rel.blog ? `<a class="chip" href="${esc(rel.blog)}" target="_blank" rel="noopener">官方发布说明 ↗</a>` : ''}
            </div>
          </div>
        </div>
      </section>
      <div class="wrap rel-body">
        <nav class="strip" aria-label="本版本的站点">
          <p class="strip-title"><span>本车线路 · Swift ${rel.version}</span><span>${feats.filter((f) => learned.has(f.id)).length}/${feats.length}</span></p>
          <ol>${feats.map((f) => `<li data-id="${f.id}" data-line="${f.line}" class="${f.level === 'brief' ? 'brief' : ''}${learned.has(f.id) ? ' done' : ''}" style="--c: var(--l${f.line})"><a href="#f-${f.id}"><span class="sdot"></span><span class="s-name">${esc(f.short)}</span></a></li>`).join('')}</ol>
        </nav>
        <div class="rel-content">
          ${feats.map(featureArticle).join('')}
          <div class="next-rel">
            ${next ? `<div><div class="eyebrow">下一站</div><b style="font-size:18px">Swift ${next.version} · ${esc(next.title)}</b></div><a class="btn primary" href="#${next.id}">继续前往 ${next.version} →</a>`
                   : `<div><div class="eyebrow">终点站</div><b style="font-size:18px">你已经坐完了全部五个版本</b></div><a class="btn primary" href="#quiz">去挑战编译器猜猜看 →</a>`}
          </div>
        </div>
      </div>`;
    setupScrollSpy();
    if (focusId) scrollToFeature(focusId); else window.scrollTo(0, 0);
  }

  function setupScrollSpy() {
    const items = $$('.feature');
    if (!items.length || !('IntersectionObserver' in window)) return;
    let saveTimer;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.dataset.id;
        $$('.strip li').forEach((li) => li.classList.toggle('current', li.dataset.id === id));
        const cur = $(`.strip li[data-id="${id}"]`);
        const strip = $('.strip');
        if (cur && strip && strip.scrollWidth > strip.clientWidth + 4) {
          strip.scrollTo({ left: cur.offsetLeft - strip.clientWidth / 2 + cur.offsetWidth / 2, behavior: 'smooth' });
        } else if (cur && strip && strip.scrollHeight > strip.clientHeight + 4) {
          const top = cur.offsetTop - strip.clientHeight / 2;
          strip.scrollTo({ top, behavior: 'smooth' });
        }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => store.set('last', id), 600);
      }
    }, { rootMargin: '-90px 0px -62% 0px' });
    items.forEach((el) => io.observe(el));
    cleanup.push(() => { io.disconnect(); clearTimeout(saveTimer); });
  }

  // ───────────────────────── 实验室：入口 ─────────────────────────
  function viewLabs() {
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow">动手</div><h1>实验室</h1>
        <p>三个可以亲手操作的小实验，外加一个小游戏。实验里展示的编译器结论，同样来自 Swift 6.4.2 对对应代码的真实编译。</p></section>
      <div class="wrap">${labCards()}</div>`;
  }

  // ───────────────────────── 实验室：并发执行轨迹 ─────────────────────────
  function viewLabConcurrency() {
    const modes = ['concurrency-classic', 'concurrency-nonsending', 'concurrency-concurrent'].map((id) => D.labs[id]).filter(Boolean);
    let mode = 0, step = -1, timer = null;
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow"><span class="bullet sm" data-line="1" style="vertical-align:-3px">1</span> 实验室 · 并发安全</div>
        <h1>并发执行轨迹</h1>
        <p>同一个 <code>@MainActor</code> 视图模型调用一个普通类的 <code>async</code> 方法。它的每一行到底在哪里执行？切换规则，按“下一步”逐行看。</p></section>
      <div class="wrap">
        <div class="seg" id="modeSeg" role="group" aria-label="选择并发规则">${modes.map((m, i) => `<button type="button" data-mode="${i}" aria-pressed="${i === 0}">${m.title}<small>${text(m.note)}</small></button>`).join('')}</div>
        <div class="lab" style="margin-top:16px">
          <div class="panel"><div class="panel-head"><span>main.swift</span><code id="flagLbl" style="font-size:11.5px"></code></div><div id="labCode"></div></div>
          <div class="panel">
            <div class="panel-head"><span>执行轨迹</span>
              <div class="lab-controls">
                <button class="btn small" type="button" id="stPrev">← 上一步</button>
                <button class="btn small primary" type="button" id="stPlay">▶ 播放</button>
                <button class="btn small" type="button" id="stNext">下一步 →</button>
                <button class="btn small" type="button" id="stReset">重来</button>
              </div>
            </div>
            <div class="lanes"><div class="lane-head main lane-col"><i></i>主 actor（主线程）</div><div class="lane-head pool"><i></i>全局并发线程池</div></div>
            <div class="trace" id="trace"></div>
            <div class="step-say" id="stepSay" aria-live="polite"></div>
          </div>
        </div>
        <div class="verdict" id="verdict"></div>
        <div class="cmp" id="cmp"></div>
      </div>`;

    const codeLines = (m) => m.code.split('\n');
    const chipText = (m, st) => {
      if (st.lane === 'out') return '→ 离开主 actor，切换到线程池';
      if (st.lane === 'in') return '← 切回主 actor';
      const line = codeLines(m).find((l) => l.includes(st.mark)) || '';
      const codeOnly = line.replace(/\/\/.*$/, '').trim();
      return `<span class="mk">${esc(st.mark)}</span><code>${esc(codeOnly)}</code>${st.lane === 'wait' ? ' · 挂起' : ''}`;
    };

    function paintCode() {
      const m = modes[mode];
      const st = m.steps[step];
      const lineNo = st ? codeLines(m).findIndex((l) => l.includes(st.mark)) + 1 : 0;
      $('#labCode').innerHTML = codeFigure({ code: m.code, lang: 'swift' }, { noResult: true, bare: true, hlSet: new Set(lineNo ? [lineNo] : []) });
      $('#flagLbl').textContent = m.flags.replace('-swift-version 6', '').trim() || '-swift-version 6';
    }

    function paintTrace() {
      const m = modes[mode];
      const tr = $('#trace');
      tr.classList.toggle('playing', step >= 0);
      tr.innerHTML = m.steps.map((st, i) => {
        const state = step < 0 ? '' : i === step ? ' now' : i > step ? ' future' : '';
        const kind = st.lane === 'out' || st.lane === 'in' ? 'hop' : st.lane;
        const chip = `<div class="step-chip ${kind}${state}">${chipText(m, st)}</div>`;
        if (kind === 'hop') return `<div class="cell span2">${chip}</div>`;
        if (st.lane === 'pool') return `<div class="cell main-col"></div><div class="cell">${chip}</div>`;
        return `<div class="cell main-col">${chip}</div><div class="cell"></div>`;
      }).join('');
      $('#stepSay').innerHTML = step < 0
        ? '完整轨迹如上。点“下一步”或“播放”，逐行跟踪执行位置。'
        : `<b>第 ${step + 1}/${m.steps.length} 步：</b>${m.steps[step].text}`;
      $('#stPrev').disabled = step < 0;
      $('#stNext').disabled = step >= m.steps.length - 1;
    }

    function paintVerdict() {
      const m = modes[mode];
      const r = m.result;
      const ok = r.status === 'ok';
      $('#verdict').innerHTML = `<div class="verdict-head"><h3>编译器怎么说？</h3><span class="badge ${ok ? 'ok' : 'error'}">${ok ? '编译通过' : '编译错误'}</span><span class="muted" style="font-size:13px">Swift 6.4.2 对左侧代码的真实编译结果</span></div>
        <div class="code-cmd" style="border-radius:var(--radius) var(--radius) 0 0">$ ${esc(r.command)}</div>
        <pre class="term" style="border-radius:0 0 var(--radius) var(--radius)">${r.diagnostics ? renderTerm(r.diagnostics) : '<span class="t-ok">✓ 没有错误，也没有警告</span>'}</pre>`;
    }

    function paintCmp() {
      $('#cmp').innerHTML = modes.map((m, i) => {
        const hops = m.steps.filter((s) => s.lane === 'out' || s.lane === 'in').length;
        const ok = m.result.status === 'ok';
        return `<div style="${i === mode ? 'border-color:var(--ink)' : ''}"><b>${m.title}</b>线程切换 ${hops} 次 · ${ok ? '<span style="color:var(--ok)">编译通过</span>' : '<span style="color:var(--err)">编译报错</span>'}<br><span class="muted">${i === 0 ? '非 Sendable 的 api 被带去了别的线程' : i === 1 ? '全程在主 actor 上，但 parse 会占用主线程' : '只有耗时的 parse 被显式送去后台'}</span></div>`;
      }).join('');
    }

    function paint() { paintCode(); paintTrace(); }
    function stop() { clearInterval(timer); timer = null; $('#stPlay').textContent = '▶ 播放'; }
    function setMode(i) {
      mode = i; step = -1; stop();
      $$('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.mode === i)));
      paint(); paintVerdict(); paintCmp();
    }
    $('#modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setMode(+b.dataset.mode); });
    $('#stNext').addEventListener('click', () => { stop(); step = Math.min(step + 1, modes[mode].steps.length - 1); paint(); });
    $('#stPrev').addEventListener('click', () => { stop(); step = Math.max(step - 1, -1); paint(); });
    $('#stReset').addEventListener('click', () => { stop(); step = -1; paint(); });
    $('#stPlay').addEventListener('click', () => {
      if (timer) { stop(); return; }
      if (step >= modes[mode].steps.length - 1) step = -1;
      $('#stPlay').textContent = '❚❚ 暂停';
      const tick = () => {
        step++;
        paint();
        if (step >= modes[mode].steps.length - 1) stop();
      };
      tick();
      timer = setInterval(tick, matchMedia('(prefers-reduced-motion: reduce)').matches ? 2600 : 1500);
    });
    cleanup.push(() => clearInterval(timer));
    setMode(0);
  }

  // ───────────────────────── 实验室：所有权沙盒 ─────────────────────────
  function primaryError(lab) {
    const diag = D.labs[lab]?.result?.diagnostics || '';
    const m = /error: (.+?)(?: \[#[^\]]+\])?$/m.exec(diag);
    return m ? m[1] : '';
  }

  function viewLabOwnership() {
    const MSG = {
      used: primaryError('ownership-move') || "'a' used after consume",
      twice: primaryError('ownership-twice') || "'a' consumed more than once",
      copy: primaryError('ownership-copy') || "'copy' cannot be applied to noncopyable types",
    };
    const withName = (msg, name) => msg.replace(/'a'/, `'${name}'`);
    let copyable = false;
    let S;
    function reset() {
      S = { vars: { a: { declared: true, ticket: { no: 1 }, gone: '' }, b: { declared: false }, c: { declared: false } }, log: [{ code: 'let a = Ticket(id: 1)', status: 'ok' }], msg: null, nextNo: 2 };
    }
    reset();

    const ACTIONS = [
      { code: 'inspect(a)', run: () => borrow('a'), tip: '借用：只读' },
      { code: 'let b = a', run: () => move('a', 'b'), tip: '移动 / 复制' },
      { code: 'inspect(b)', run: () => borrow('b'), tip: '借用：只读' },
      { code: 'a.punch()', run: () => punch('a'), tip: 'consuming：检票' },
      { code: 'b.punch()', run: () => punch('b'), tip: 'consuming：检票' },
      { code: 'let c = copy a', run: () => copyOp('a', 'c'), tip: '显式复制' },
    ];

    const fail = (code, message, why) => { S.log.push({ code, status: 'rejected' }); S.msg = { kind: 'bad', message, why }; };
    function need(name, code) {
      const v = S.vars[name];
      if (!v.declared) { fail(code, `cannot find '${name}' in scope`, `变量 ${name} 还没有声明。`); return null; }
      return v;
    }
    function borrow(name) {
      const code = `inspect(${name})`;
      const v = need(name, code); if (!v) return;
      if (!v.ticket) { fail(code, withName(MSG.used, name), `${name} 的值已经被${v.gone}，不能再借用。`); return; }
      S.log.push({ code, status: 'ok' });
      S.msg = { kind: 'ok', why: `借用 ${name}：只读地看一眼 ${v.ticket.no} 号票，所有权不变。` };
      S.flash = name;
    }
    function move(from, to) {
      const code = `let ${to} = ${from}`;
      const v = need(from, code); if (!v) return;
      if (S.vars[to].declared) { fail(code, `invalid redeclaration of '${to}'`, `${to} 已经声明过了，点“重来”再试。`); return; }
      if (!v.ticket) { fail(code, withName(MSG.twice, from), `${from} 的值已经被${v.gone}，没有东西可以再移动。`); return; }
      if (copyable) {
        S.vars[to] = { declared: true, ticket: { no: v.ticket.no, dup: true, punched: v.ticket.punched }, gone: '' };
        S.log.push({ code, status: 'copied' });
        S.msg = { kind: 'warn', why: `Ticket 是普通的可复制类型，于是 ${to} 得到了一张**一模一样的复印票**。现在有两张 ${v.ticket.no} 号票，可以各检一次。编译器帮不了你。` };
      } else {
        S.vars[to] = { declared: true, ticket: v.ticket, gone: '' };
        v.ticket = null; v.gone = `移动到 ${to}`;
        S.log.push({ code, status: 'ok' });
        S.msg = { kind: 'ok', why: `所有权从 ${from} **移动**到了 ${to}。从现在起，${from} 不能再使用。` };
      }
    }
    function punch(name) {
      const code = `${name}.punch()`;
      const v = need(name, code); if (!v) return;
      if (!v.ticket) { fail(code, withName(MSG.twice, name), `${name} 的值已经被${v.gone}，不能再消耗一次。`); return; }
      if (copyable) {
        const again = v.ticket.punched;
        v.ticket = { ...v.ticket, punched: true };
        S.log.push({ code, status: again ? 'copied' : 'ok' });
        S.msg = again
          ? { kind: 'warn', why: `同一张票被**检了两次**！可复制类型的 consuming 方法会悄悄复制一份，所以编译器不会阻止。` }
          : { kind: 'ok', why: `检票成功。但 ${name} 依然可以继续使用，因为可复制的值会被隐式复制。` };
      } else {
        v.ticket = null; v.gone = '检票消耗';
        S.log.push({ code, status: 'ok' });
        S.msg = { kind: 'ok', why: `consuming 方法拿走了 ${name} 的所有权：票检完就被回收（deinit 执行），${name} 从此不可用。` };
      }
    }
    function copyOp(from, to) {
      const code = `let ${to} = copy ${from}`;
      if (!copyable) { fail(code, MSG.copy, '不可复制的类型不允许任何形式的复制，包括显式的 copy。'); return; }
      const v = need(from, code); if (!v) return;
      if (S.vars[to].declared) { fail(code, `invalid redeclaration of '${to}'`, `${to} 已经声明过了，点“重来”再试。`); return; }
      if (!v.ticket) { fail(code, withName(MSG.used, from), `${from} 已经不可用。`); return; }
      S.vars[to] = { declared: true, ticket: { no: v.ticket.no, dup: true, punched: v.ticket.punched }, gone: '' };
      S.log.push({ code, status: 'copied' });
      S.msg = { kind: 'warn', why: `显式复制成功：又多了一张 ${v.ticket.no} 号票。` };
    }

    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow"><span class="bullet sm" data-line="2" style="vertical-align:-3px">2</span> 实验室 · 所有权与性能</div>
        <h1>所有权沙盒</h1>
        <p>一张地铁票不应该能被复印。下面的 <code>Ticket</code> 有一个 <code>consuming func punch()</code>（检票）。点按钮往程序里追加一行代码，看编译器接受还是拒绝。</p></section>
      <div class="wrap">
        <div class="seg" id="ownSeg" role="group" aria-label="Ticket 的类型">
          <button type="button" data-copyable="0" aria-pressed="true">struct Ticket: ~Copyable<small>不可复制：编译器保证一票一检</small></button>
          <button type="button" data-copyable="1" aria-pressed="false">struct Ticket<small>普通的可复制类型：对照组</small></button>
        </div>
        <div class="lab" style="margin-top:16px">
          <div class="panel">
            <div class="panel-head"><span>变量与它们持有的票</span><button class="btn small" type="button" id="ownReset">重来</button></div>
            <div class="panel-body">
              <div class="slots" id="slots"></div>
              <div class="actions" style="margin-top:14px" id="ownActions">${ACTIONS.map((a, i) => `<button class="btn small" type="button" data-act="${i}" title="${esc(a.tip)}">${esc(a.code)}</button>`).join('')}</div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-head"><span>main.swift</span><span class="muted" id="ownSig"></span></div>
            <div id="ownCode"></div>
            <div class="panel-body sandbox-msg" id="ownMsg"></div>
          </div>
        </div>
        <p class="muted" style="font-size:13px;margin-top:12px">错误信息的文字取自 Swift 6.4.2 对等价代码的真实编译输出（例如 <code>${esc(MSG.used)}</code>）。被拒绝的行不会改变程序状态。</p>
      </div>`;

    function paint() {
      $('#slots').innerHTML = ['a', 'b', 'c'].map((name) => {
        const v = S.vars[name];
        let inner;
        if (!v.declared) inner = '<div class="ghost">未声明</div>';
        else if (v.ticket) inner = `<div class="ticket${v.ticket.punched ? ' punched' : ''}${v.ticket.dup ? ' dup' : ''}${S.flash === name ? ' flash' : ''}"><b>No.${v.ticket.no}</b>${v.ticket.dup ? '复印的票' : '单程票'}${v.ticket.punched ? ' · 已检' : ''}</div>`;
        else inner = `<div class="ghost">已${esc(v.gone)}<br>不可再用</div>`;
        const tag = !v.declared ? '' : v.ticket ? '持有' : '已失效';
        return `<div class="slot${v.declared ? ' declared' : ''}"><div class="slot-name"><span>${name}</span><span class="muted">${tag}</span></div>${inner}</div>`;
      }).join('');
      S.flash = null;
      const code = (copyable ? 'struct Ticket {\n' : 'struct Ticket: ~Copyable {\n') + '    let id: Int\n    consuming func punch() { }\n}\nfunc inspect(_ t: borrowing Ticket) { }\n\n' + S.log.map((l) => l.code).join('\n');
      $('#ownCode').innerHTML = codeFigure({ code, lang: 'swift' }, { noResult: true, bare: true, attrs: ' data-log="1"' }).replace('class="code bare"', 'class="code bare code-log"');
      const offset = 6;
      S.log.forEach((l, i) => {
        const ln = $(`#ownCode .ln[data-n="${i + offset + 1}"]`);
        if (ln && l.status !== 'ok') ln.classList.add(l.status === 'rejected' ? 'rejected' : 'copied');
      });
      $('#ownSig').textContent = copyable ? '可复制' : '~Copyable';
      const m = S.msg;
      $('#ownMsg').innerHTML = !m ? '<div class="callout">试试：先点 <code>let b = a</code>，再点 <code>inspect(a)</code>。然后切换到“普通的可复制类型”对比一下。</div>'
        : m.kind === 'bad' ? `<div class="callout bad"><b>编译器拒绝了这一行</b><pre class="term" style="margin:8px 0;border-radius:8px"><span class="t-err">error:</span> ${esc(m.message)}</pre>${esc(m.why)}</div>`
          : `<div class="callout${m.kind === 'warn' ? ' warnish' : ''}">${esc(m.why).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</div>`;
    }

    $('#ownActions').addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (!b) return; ACTIONS[+b.dataset.act].run(); paint(); });
    $('#ownReset').addEventListener('click', () => { reset(); paint(); });
    $('#ownSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-copyable]'); if (!b) return;
      copyable = b.dataset.copyable === '1';
      $$('#ownSeg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      reset(); paint();
    });
    paint();
  }

  // ───────────────────────── 实验室：内存布局 ─────────────────────────
  function viewLabMemory() {
    const table = D.labs['memory-table']?.table || [];
    let ti = Math.max(0, table.findIndex((r) => r.name === 'Int'));
    let n = 4;
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow"><span class="bullet sm" data-line="2" style="vertical-align:-3px">2</span> 实验室 · 所有权与性能</div>
        <h1>内存布局</h1>
        <p>同样存 N 个元素，<code>[T]</code>、<code>[N of T]</code> 和 <code>Span&lt;T&gt;</code> 在内存里差别很大。每个小方块代表 1 个字节，每行 16 字节，就像十六进制转储。尺寸数据来自 Swift 6.4.2 在 arm64 上的真实运行结果。</p></section>
      <div class="wrap">
        <div class="mem-controls">
          <div class="seg" id="memType" role="group" aria-label="元素类型">${table.map((r, i) => `<button type="button" data-t="${i}" aria-pressed="${i === ti}"><code style="background:none;border:0;padding:0">${esc(r.name)}</code></button>`).join('')}</div>
          <label for="memN">元素个数 N <input id="memN" type="range" min="1" max="8" value="${n}"> <b id="memNv" class="num">${n}</b></label>
        </div>
        <div class="mem-grid" id="memGrid"></div>
        <div class="legend-row">
          <span><i class="byte ptr"></i>指针</span><span><i class="byte hdr"></i>堆对象头部（类型信息、引用计数、count、capacity）</span>
          <span data-line="2"><i class="byte el"></i>元素</span><span><i class="byte pad"></i>对齐填充</span><span><i class="byte cnt"></i>长度</span>
        </div>
      </div>`;

    const dump = (cells) => {
      let s = '<div class="hexdump">';
      for (let r = 0; r < Math.ceil(cells.length / 16); r++) {
        s += `<span class="off">${(r * 16).toString(16).padStart(2, '0').toUpperCase()}</span>`;
        for (let k = 0; k < 16; k++) { const c = cells[r * 16 + k]; s += c ? `<i class="byte ${c}"></i>` : '<i></i>'; }
      }
      return s + '</div>';
    };
    const elementCells = (row) => {
      const cells = [];
      for (let k = 0; k < n; k++) {
        for (let b = 0; b < row.stride; b++) cells.push(b < row.size ? 'el' + (k % 2 ? ' alt' : '') : 'pad');
      }
      return cells;
    };

    function paint() {
      const row = table[ti];
      if (!row) { $('#memGrid').innerHTML = '<p>没有内存数据。</p>'; return; }
      const els = elementCells(row);
      const inlineSize = row.inline[n - 1];
      const arrayHeap = 32 + n * row.stride;
      $('#memGrid').innerHTML = `
        <section class="mem-card" data-line="2">
          <h3>[${esc(row.name)}]<span>Array</span></h3>
          <div class="mem-area"><span>栈上 / 所属对象里</span><span>${row.array} 字节</span></div>
          ${dump(Array(row.array).fill('ptr'))}
          <div class="mem-arrow">↓ 指向堆上的一块存储（另外分配）</div>
          <div class="mem-area"><span>堆上</span><span>32 + ${n}×${row.stride} = ${arrayHeap} 字节起</span></div>
          ${dump([...Array(32).fill('hdr'), ...els])}
          <ul class="mem-facts"><li>MemoryLayout.size<b>${row.array}</b></li><li>堆分配<b>1 次</b></li><li>引用计数 / 写时复制<b>有</b></li><li>长度可变<b>是</b></li></ul>
        </section>
        <section class="mem-card" data-line="2">
          <h3>[${n} of ${esc(row.name)}]<span>InlineArray</span></h3>
          <div class="mem-area"><span>栈上 / 所属对象里</span><span>${n}×${row.stride} = ${inlineSize} 字节</span></div>
          ${dump(els)}
          <ul class="mem-facts"><li>MemoryLayout.size<b>${inlineSize}</b></li><li>堆分配<b>0 次</b></li><li>引用计数 / 写时复制<b>无</b></li><li>长度可变<b>否（写在类型里）</b></li><li>复制时<b>复制全部 ${inlineSize} 字节</b></li></ul>
        </section>
        <section class="mem-card" data-line="2">
          <h3>Span&lt;${esc(row.name)}&gt;<span>Span</span></h3>
          <div class="mem-area"><span>栈上</span><span>${row.span} 字节</span></div>
          ${dump([...Array(8).fill('ptr'), ...Array(Math.max(0, row.span - 8)).fill('cnt')])}
          <div class="mem-arrow">↗ 指向左边任意一种存储里的元素，自己不拥有内存</div>
          <ul class="mem-facts"><li>MemoryLayout.size<b>${row.span}</b></li><li>堆分配<b>0 次</b></li><li>引用计数<b>无</b></li><li>生命周期<b>受限于源数据（~Escapable）</b></li><li>复制时<b>只复制指针和长度</b></li></ul>
        </section>`;
    }
    $('#memType').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]'); if (!b) return;
      ti = +b.dataset.t;
      $$('#memType button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      paint();
    });
    $('#memN').addEventListener('input', (e) => { n = +e.target.value; $('#memNv').textContent = n; paint(); });
    paint();
  }

  // ───────────────────────── 编译器猜猜看 ─────────────────────────
  function viewQuiz() {
    const qs = D.challenges;
    let i = 0;
    const results = [];
    const LABEL = { ok: '编译通过', warning: '有警告', error: '编译错误' };
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow">小游戏</div><h1>编译器猜猜看</h1>
        <p>${qs.length} 段代码，猜猜 Swift 6.4.2 会怎么说：顺利通过、给出警告，还是直接报错？标准答案不是人写的，是构建时真实编译得到的。</p></section>
      <div class="wrap quiz-stage" id="qstage"></div>`;

    function paintQuestion() {
      const q = qs[i];
      const best = store.get('quizBest', null);
      $('#qstage').innerHTML = `
        <div class="qhud"><span>第 <b class="num">${i + 1}</b> / ${qs.length} 题 · 答对 <b class="num">${results.filter(Boolean).length}</b>${best != null ? ` · 最佳 ${best}/${qs.length}` : ''}</span>
          <span class="qdots">${qs.map((_, k) => `<i class="${k < results.length ? (results[k] ? 'right' : 'wrong') : k === i ? 'now' : ''}"></i>`).join('')}</span></div>
        <div class="qcard">
          <div class="f-top" style="margin:0"><span class="chip">${esc(q.topic)}</span><code style="font-size:11.5px">${esc(q.flags)}</code></div>
          <h2>${q.title}</h2>
          ${codeFigure({ code: q.code, lang: 'swift' }, { noResult: true })}
          <div class="qchoices" id="qchoices">
            <button type="button" data-v="ok"><span class="sym">✓</span>编译通过<small>没有任何诊断</small></button>
            <button type="button" data-v="warning"><span class="sym">!</span>有警告<small>能编译，但有提醒</small></button>
            <button type="button" data-v="error"><span class="sym">✕</span>编译错误<small>编译器拒绝</small></button>
          </div>
          <div class="qresult" id="qresult" hidden></div>
        </div>`;
      $('#qchoices').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-v]');
        if (!b || b.disabled) return;
        const right = b.dataset.v === q.answer;
        results.push(right);
        $$('#qchoices button').forEach((x) => { x.disabled = true; if (x.dataset.v === q.answer) x.classList.add('truth'); });
        b.classList.add('picked');
        const rel = FMAP.get(q.related);
        const res = $('#qresult');
        res.hidden = false;
        res.innerHTML = `
          <div class="verdict-line ${right ? 'right' : 'wrong'}">${right ? '答对了！' : `没猜中：正确答案是“${LABEL[q.answer]}”`}</div>
          <div><div class="code-cmd" style="border-radius:var(--radius) var(--radius) 0 0">$ swiftc ${esc(q.flags)} main.swift</div>
          <pre class="term" style="border-radius:0 0 var(--radius) var(--radius)">${q.diagnostics ? renderTerm(q.diagnostics) : '<span class="t-ok">✓ 没有错误，也没有警告</span>'}</pre></div>
          <p>${q.explain}</p>
          <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center">
            ${rel ? `<a class="chip" href="#f-${rel.id}">相关课程：${esc(rel.plainTitle)} →</a>` : '<span></span>'}
            <button class="btn primary" type="button" id="qnext">${i < qs.length - 1 ? '下一题 →' : '查看成绩'}</button>
          </div>`;
        $('#qnext').addEventListener('click', () => { i++; if (i < qs.length) paintQuestion(); else paintFinal(); window.scrollTo({ top: 0 }); });
        $('#qnext').focus({ preventScroll: true });
      });
    }

    function paintFinal() {
      const score = results.filter(Boolean).length;
      const best = Math.max(score, store.get('quizBest', 0) || 0);
      store.set('quizBest', best);
      const wrong = qs.filter((_, k) => !results[k]);
      const msg = score === qs.length ? '满分！你已经能预判编译器了。' : score >= qs.length * 0.75 ? '很厉害，大部分规则都掌握了。' : score >= qs.length * 0.5 ? '不错，再复习几站就稳了。' : '多看看下面这些站，再来一次。';
      $('#qstage').innerHTML = `<div class="qcard qfinal">
        <div class="eyebrow">成绩</div><div class="big num">${score}<span style="font-size:28px;color:var(--ink-3)">/${qs.length}</span></div>
        <p>${msg}</p>
        ${wrong.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">${wrong.map((q) => { const f = FMAP.get(q.related); return f ? `<a class="chip" href="#f-${f.id}">${esc(f.short)}</a>` : ''; }).join('')}</div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><button class="btn primary" type="button" id="qagain">再来一次</button><a class="btn" href="#pass">查看通行卡</a></div>
      </div>`;
      $('#qagain').addEventListener('click', () => { i = 0; results.length = 0; paintQuestion(); });
    }
    paintQuestion();
  }

  // ───────────────────────── 提案总表 ─────────────────────────
  function viewIndex() {
    const P = D.proposals;
    const verOf = (p) => (p.version ? p.version : 'pending');
    const versions = ['all', '6.0', '6.1', '6.2', '6.2.3', '6.3', '6.4', '6.5', 'pending'];
    const VLABEL = { all: '全部', pending: '已接受 / 审核中', '6.5': '6.5（开发中）' };
    const STATE = { accepted: '已接受', activeReview: '审核中', acceptedWithRevisions: '修改后接受', scheduledForReview: '待审核', implemented: '已实现' };
    let fv = 'all', fl = 0, q = '';
    const in65 = P.filter((p) => p.version === '6.5');
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow">参考</div><h1>提案总表</h1>
        <p>Swift 6.0 以来在 Swift Evolution 中实现或接受的全部 ${P.length} 个提案。线路颜色是本站的分类；有课程的提案可以直接跳转。数据来自 Swift Evolution 官方索引（快照 ${esc(D.meta.evolutionDate)}）。</p></section>
      <div class="wrap">
        <div class="next-station">
          <div class="big">6.5</div>
          <div><b>下一站：Swift 6.5（开发中）</b><p class="muted" style="margin-top:4px">已有 ${in65.length} 个提案在主分支上实现，例如 ${in65.slice(0, 4).map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title.replace(/`/g, ''))}</a>`).join('、')}。正式发布前仍可能变化。</p></div>
        </div>
        <div class="filters">
          <div class="filter-row" id="fVer"><span class="lbl">版本</span>${versions.map((v) => `<button type="button" data-v="${v}" aria-pressed="${v === fv}">${VLABEL[v] || v}</button>`).join('')}</div>
          <div class="filter-row" id="fLine"><span class="lbl">线路</span><button type="button" data-l="0" aria-pressed="true">全部</button>${D.lines.map((l) => `<button type="button" data-l="${l.id}" data-line="${l.id}" aria-pressed="false"><span class="bullet sm">${l.id}</span>${esc(l.name)}</button>`).join('')}</div>
          <div class="filter-row"><span class="lbl">搜索</span><input class="text-filter" id="fText" type="search" placeholder="标题或编号，例如 Span、0461"></div>
        </div>
        <p class="count-line" id="pCount"></p>
        <div class="table-wrap"><table class="ptable"><thead><tr><th>编号</th><th>标题</th><th>版本</th><th>线路</th><th>本站课程</th></tr></thead><tbody id="pBody"></tbody></table></div>
      </div>`;

    function paint() {
      const qq = q.trim().toLowerCase();
      const rows = P.filter((p) => (fv === 'all' || verOf(p) === fv) && (!fl || p.line === fl)
        && (!qq || p.title.toLowerCase().includes(qq) || p.id.toLowerCase().includes(qq) || (p.flag || '').toLowerCase().includes(qq)))
        .sort((a, b) => (verOf(a) === verOf(b) ? a.id.localeCompare(b.id) : verOf(a).localeCompare(verOf(b), 'en', { numeric: true })));
      $('#pCount').textContent = `共 ${rows.length} 个提案`;
      $('#pBody').innerHTML = rows.map((p) => {
        const f = FMAP.get(p.feature);
        const pend = !p.version;
        return `<tr class="${pend || p.version === '6.5' ? 'future' : ''}">
          <td class="id"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.id)}</a></td>
          <td><span class="ptitle">${esc(p.title.replace(/`/g, ''))}</span>${p.flag ? `<span class="flagname">${esc(p.flag)}</span>` : ''}</td>
          <td class="ver">${pend ? `<span class="chip">${STATE[p.state] || esc(p.state)}</span>` : esc(p.version)}</td>
          <td><span class="bullet sm" data-line="${p.line}" title="${esc(LINES.get(p.line).name)}">${p.line}</span></td>
          <td>${f ? `<a href="#f-${f.id}">${esc(f.short)} →</a>` : '<span class="muted">—</span>'}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">没有匹配的提案</td></tr>';
    }
    $('#fVer').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; fv = b.dataset.v; $$('#fVer button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint(); });
    $('#fLine').addEventListener('click', (e) => { const b = e.target.closest('button[data-l]'); if (!b) return; fl = +b.dataset.l; $$('#fLine button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint(); });
    $('#fText').addEventListener('input', (e) => { q = e.target.value; paint(); });
    paint();
  }

  // ───────────────────────── 通行卡 ─────────────────────────
  function viewPass() {
    const total = FEATURES.length;
    const done = FEATURES.filter((f) => learned.has(f.id)).length;
    const pct = Math.round((done / total) * 100);
    const best = store.get('quizBest', null);
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow">我的进度</div><h1>通行卡</h1>
        <p>在每一站底部点“打卡”，这里就会记下来。记录只保存在当前浏览器里，换设备或清除网站数据后会重新开始。</p></section>
      <div class="wrap pass-grid">
        <div>
          <div class="card" aria-label="通行卡：已完成 ${pct}%">
            <div class="card-top"><div><b>SWIFT CLUB</b><span>进化线路通行卡 · 6.0 – 6.4</span></div><svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="var(--brand)"/><path d="M8.5 21 L14.5 14.5 H23.5" fill="none" stroke="var(--brand-on)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8.5" cy="21" r="3.3" fill="var(--brand-on)"/><circle cx="23.5" cy="14.5" r="3.3" fill="var(--brand-on)"/></svg></div>
            <div class="card-pct num">${pct}%<small>已打卡 ${done} / ${total} 站</small></div>
            <div class="card-bottom"><span>首次乘车 ${esc(fmtDate(firstRide))}</span><span>猜猜看最佳 ${best == null ? '—' : `${best}/${D.challenges.length}`}</span></div>
            <div class="card-stripes" aria-hidden="true">${D.lines.map((l) => { const fs = FEATURES.filter((f) => f.line === l.id); const d = fs.filter((f) => learned.has(f.id)).length; return `<i style="--c: var(--l${l.id})"><b style="width:${(d / fs.length) * 100}%"></b></i>`; }).join('')}</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
            <a class="btn primary" href="${(() => { const f = FEATURES.find((x) => !learned.has(x.id)); return f ? '#f-' + f.id : '#quiz'; })()}">${done < total ? '去下一个未打卡的站 →' : '全部打卡！去挑战猜猜看 →'}</a>
            <button class="btn" type="button" id="resetBtn">清空记录</button>
          </div>
        </div>
        <div>
          <h2 style="font-family:var(--font-display);font-size:20px;margin-bottom:14px">各线路进度</h2>
          <div class="lines-prog">${D.lines.map((l) => {
            const fs = FEATURES.filter((f) => f.line === l.id);
            const d = fs.filter((f) => learned.has(f.id)).length;
            return `<div class="lp-row" data-line="${l.id}"><span class="bullet">${l.id}</span><div><div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(l.name)}</span></div><div class="meter"><i style="width:${(d / fs.length) * 100}%"></i></div></div><span class="num">${d}/${fs.length}</span></div>`;
          }).join('')}</div>
          <div class="punch-grid">${RELEASES.map((r) => `<div class="pg-row"><a class="pg-ver" href="#${r.id}" style="color:var(--ink);text-decoration:none">${r.version}</a><div class="pg-holes">${r.features.map((id) => { const f = FMAP.get(id); return `<a href="#f-${f.id}" data-line="${f.line}" class="${learned.has(f.id) ? 'done' : ''}" style="border-color:var(--c);${learned.has(f.id) ? 'background:var(--c)' : ''}" title="${esc(f.plainTitle)}" aria-label="${esc(f.plainTitle)}${learned.has(f.id) ? '（已打卡）' : ''}"></a>`; }).join('')}</div></div>`).join('')}</div>
        </div>
      </div>`;
    let armed = false, armTimer;
    $('#resetBtn').addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (!armed) { armed = true; b.textContent = '再点一次确认清空'; b.style.borderColor = 'var(--err)'; armTimer = setTimeout(() => { armed = false; b.textContent = '清空记录'; b.style.borderColor = ''; }, 3000); return; }
      clearTimeout(armTimer);
      learned = new Set(); store.set('learned', []); store.set('quizBest', null); store.set('last', null);
      toast('记录已清空');
      viewPass();
    });
    cleanup.push(() => clearTimeout(armTimer));
  }

  // ───────────────────────── 搜索 ─────────────────────────
  const index = [
    ...FEATURES.map((f) => ({ kind: 'f', f, hay: [f.plainTitle, f.en, f.short, f.tags, text(f.tldr), f.se.map((s) => s.id + ' ' + s.id.slice(3)).join(' '), f.flag, 'swift ' + f.release].join(' ').toLowerCase() })),
    ...D.proposals.map((p) => ({ kind: 'p', p, hay: (p.id + ' ' + p.id.slice(3) + ' ' + p.title + ' ' + (p.flag || '')).toLowerCase() })),
  ];
  let active = 0;
  function openSearch() {
    $('#search').hidden = false;
    const inp = $('#searchInput');
    inp.value = '';
    paintSearch('');
    setTimeout(() => inp.focus(), 0);
  }
  function closeSearch() { $('#search').hidden = true; }
  function paintSearch(q) {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let hits;
    if (!terms.length) hits = index.filter((x) => x.kind === 'f' && x.f.level === 'core');
    else {
      hits = index.filter((x) => terms.every((t) => x.hay.includes(t)));
      const score = (x) => (x.kind === 'f' ? 0 : 10) + (x.kind === 'f' && terms.some((t) => x.f.plainTitle.toLowerCase().includes(t)) ? 0 : 3);
      hits.sort((a, b) => score(a) - score(b));
    }
    const fs = hits.filter((x) => x.kind === 'f').slice(0, 12);
    const ps = hits.filter((x) => x.kind === 'p').slice(0, terms.length ? 8 : 0);
    active = 0;
    const li = (href, bullet, title, sub, ext) => `<li><a href="${href}"${ext ? ' target="_blank" rel="noopener"' : ''}>${bullet}<span class="sr-main"><b>${title}</b><span>${sub}</span></span></a></li>`;
    $('#searchResults').innerHTML = (!fs.length && !ps.length) ? '<li class="empty">没有找到，换个关键字试试</li>'
      : (fs.length ? `<li class="group">${terms.length ? '特性' : '核心特性'}</li>` : '') + fs.map((x) => li(`#f-${x.f.id}`, `<span class="bullet sm" data-line="${x.f.line}">${x.f.line}</span>`, `${esc(x.f.plainTitle)} <span class="muted" style="display:inline;font-weight:400">· ${x.f.since}</span>`, esc(text(x.f.tldr)))).join('')
        + (ps.length ? '<li class="group">Evolution 提案</li>' : '') + ps.map((x) => li(x.p.url, `<span class="chip mono" style="flex:none">${esc(x.p.id)}</span>`, esc(x.p.title.replace(/`/g, '')), x.p.version ? `Swift ${esc(x.p.version)}` : esc(x.p.state), true)).join('');
    markActive();
  }
  function markActive() { $$('#searchResults a').forEach((a, i) => a.classList.toggle('active', i === active)); }

  $('#searchBtn').addEventListener('click', openSearch);
  $('#searchClose').addEventListener('click', closeSearch);
  $('#search').addEventListener('click', (e) => { if (e.target.id === 'search') closeSearch(); if (e.target.closest('#searchResults a')) closeSearch(); });
  $('#searchInput').addEventListener('input', (e) => paintSearch(e.target.value));
  $('#searchInput').addEventListener('keydown', (e) => {
    const links = $$('#searchResults a');
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, links.length - 1); markActive(); links[active]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); markActive(); links[active]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { const a = links[active]; if (a) { e.preventDefault(); a.click(); closeSearch(); } }
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === 'Escape' && !$('#search').hidden) { closeSearch(); return; }
    if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) { e.preventDefault(); openSearch(); }
  });

  // ───────────────────────── 主题 ─────────────────────────
  const savedTheme = store.get('theme', null);
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.setAttribute('data-theme', savedTheme);
  $('#themeBtn').addEventListener('click', () => {
    const attr = document.documentElement.getAttribute('data-theme');
    const dark = attr ? attr === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('theme', next);
    toast(next === 'dark' ? '已切换为深色' : '已切换为浅色');
  });

  // ───────────────────────── 全局事件委托 ─────────────────────────
  document.addEventListener('click', (e) => {
    const punch = e.target.closest('[data-punch]');
    if (punch) { const id = punch.dataset.punch; setLearned(id, !learned.has(id)); return; }
    const opt = e.target.closest('.quiz-opts button');
    if (opt && !opt.disabled) {
      const box = opt.closest('.quiz');
      const qz = quizStore.get(box.dataset.quiz);
      const pick = +opt.dataset.i;
      $$('.quiz-opts button', box).forEach((b) => { b.disabled = true; if (+b.dataset.i === qz.answer) b.classList.add('right'); });
      if (pick !== qz.answer) opt.classList.add('wrong');
      const ex = $('.quiz-explain', box);
      ex.hidden = false;
      ex.innerHTML = `<b style="color:var(${pick === qz.answer ? '--ok' : '--err'})">${pick === qz.answer ? '答对了。' : '再想想。'}</b> ${qz.explain}`;
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const code = codeStore.get(copy.dataset.copy) || '';
      const done = () => { copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制'; }, 1400); };
      const fallback = () => {
        const pre = copy.closest('.code')?.querySelector('pre');
        if (!pre) return;
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        copy.textContent = '已选中，按 ⌘C';
      };
      try { navigator.clipboard.writeText(code).then(done, fallback); } catch { fallback(); }
      return;
    }
    const tog = e.target.closest('[data-toggle]');
    if (tog && (tog.closest('#legend') || tog.closest('.map-svg'))) { toggleLine(+tog.dataset.toggle); }
  });
  document.addEventListener('keydown', (e) => {
    const g = e.target.closest?.('.line-group');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleLine(+g.dataset.toggle); }
  });
  document.addEventListener('pointerover', (e) => {
    const st = e.target.closest?.('.station');
    if (st && e.pointerType !== 'touch') showTip(FMAP.get(st.dataset.id), e.clientX, e.clientY);
  });
  document.addEventListener('pointermove', (e) => {
    const st = e.target.closest?.('.station');
    if (st && e.pointerType !== 'touch' && !$('#tip').hidden) showTip(FMAP.get(st.dataset.id), e.clientX, e.clientY);
  });
  document.addEventListener('pointerout', (e) => { if (e.target.closest?.('.station')) hideTip(); });
  document.addEventListener('focusin', (e) => {
    const st = e.target.closest?.('.station');
    if (st) { const r = st.getBoundingClientRect(); showTip(FMAP.get(st.dataset.id), r.right, r.bottom); }
  });
  document.addEventListener('focusout', (e) => { if (e.target.closest?.('.station')) hideTip(); });

  // ───────────────────────── 页脚 & 启动 ─────────────────────────
  $('#foot').innerHTML = `<div class="wrap foot-grid">
    <div><p><b style="color:var(--ink)">Swift Club · 进化线路图</b>：Swift 6.0 – 6.4 新特性的非官方学习站。</p>
    <p>示例代码均在构建时由 <code>${esc(D.meta.compiler)}</code> 编译验证（${esc(D.meta.builtAt)}）。提案数据来自 <a href="https://www.swift.org/swift-evolution/" target="_blank" rel="noopener">Swift Evolution</a> 官方索引，版本要点参考 swift.org 的各版本发布说明。</p></div>
    <div><p>Swift 及 Swift 标志是 Apple Inc. 的商标。本站与 Apple 无关。</p><p>打卡记录只保存在你的浏览器里。快捷键：<span class="kbd">/</span> 搜索。</p></div>
  </div>`;
  renderNav();
  window.addEventListener('hashchange', route);
  route();
})();
