/* Keep Up with Swift · Evolution Line Map: page logic (no dependencies)
 *
 * All visible text comes from a per-language data bundle (assets/data.<lang>.js, built by
 * tools/build.mjs from content/<lang>/):
 *   - lessons, labs and challenges come from the Markdown files,
 *   - interface strings come from ui.json and are looked up with t() / th().
 * English is the default language; the others are loaded on demand. */
(() => {
  'use strict';

  // ───────────────────────── Data bundles & languages ─────────────────────────
  const BUNDLES = (window.SWIFT_CLUB_DATA = window.SWIFT_CLUB_DATA || {});
  const main = document.getElementById('main');
  const first = Object.values(BUNDLES)[0];
  if (!first) {
    main.innerHTML = '<div class="wrap page-head"><h1>No data yet · 还没有数据</h1><p>Run <code>node tools/build.mjs</code> in the project folder to generate <code>assets/data.*.js</code>.<br>请先在项目目录运行 <code>node tools/build.mjs</code> 生成 <code>assets/data.*.js</code>。</p></div>';
    return;
  }
  const baseBundle = BUNDLES[first.defaultLang] || first;
  const LANGS = baseBundle.languages;        // [{ code, name, short, htmlLang }]
  const DEFAULT_LANG = baseBundle.defaultLang;
  const BASE_UI = baseBundle.ui;             // fallback for any key a language lacks

  // ───────────────────────── Utilities ─────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = (html) => {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return tpl.content.textContent;
  };

  // Local storage (this browser only). The 'swiftclub:' prefix comes from the site's original name;
  // keep it, or everyone's saved progress (punched stations, quiz best) is lost.
  const store = {
    get(k, d) { try { const v = localStorage.getItem('swiftclub:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('swiftclub:' + k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
  };

  // ───────────────────────── Current language ─────────────────────────
  let lang, D, UI, PLURAL;
  let LINES, FEATURES, FMAP, ZONES, RELEASES, PRELUDE, NEWF, RMAP, ORDER;
  const FLAG_HELP = 'upcoming-features';                       // the 5.x basics station about upcoming-feature flags
  let searchIndex = [];
  let learned = new Set();
  let firstRide = null;
  let ready = false;

  const raw = (html) => ({ raw: html });                       // mark a t()/th() parameter as ready-made HTML
  const isRaw = (v) => v !== null && typeof v === 'object' && 'raw' in v;

  function message(key, params) {
    let m;
    if (params && typeof params.n === 'number') m = UI[`${key}_${PLURAL.select(params.n)}`] ?? UI[`${key}_other`];
    return m ?? UI[key] ?? BASE_UI[key] ?? key;
  }
  /** Plain-text message; `{name}` placeholders are filled from params (`n` selects the plural form). */
  const t = (key, params) => message(key, params).replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? (isRaw(params[k]) ? text(params[k].raw) : params[k]) : m));
  /** HTML message: escaped, then `code`, **bold**, [links](url) and \n become markup. */
  const th = (key, params) => esc(message(key, params))
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>')
    .replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? (isRaw(params[k]) ? params[k].raw : esc(params[k])) : m));

  const fmtDate = (iso, style) => {
    const [y, m, d] = iso.split('-');
    return t(style === 'month' ? 'date.month' : 'date.full', { y, m: +m, mm: m, d: +d, dd: d, mon: t('date.months').split(',')[+m - 1] });
  };
  const levelName = (level) => t('level.' + level);
  const swiftVersion = () => (/Swift version ([\d.]+)/.exec(D.meta.compiler) || [])[1] || D.meta.compiler;
  const relOf = (f) => ZONES.find((r) => r.version === f.release);

  /** Make a loaded bundle the current one and rebuild everything derived from it. */
  function useBundle(code) {
    lang = code;
    D = BUNDLES[code];
    UI = D.ui;
    PLURAL = new Intl.PluralRules(D.htmlLang);
    LINES = new Map(D.lines.map((l) => [l.id, l]));
    FEATURES = D.features;
    FMAP = new Map(FEATURES.map((f) => [f.id, f]));
    // Zones are the map's columns: the "before you board" prelude (5.x basics) first, then the releases.
    // The prelude's stations are lessons too, but they don't count as new features.
    ZONES = D.releases;
    RELEASES = ZONES.filter((r) => !r.prelude);
    PRELUDE = ZONES.find((r) => r.prelude) || null;
    NEWF = RELEASES.flatMap((r) => r.features).map((id) => FMAP.get(id));
    RMAP = new Map(ZONES.map((r) => [r.id, r]));
    ORDER = ZONES.flatMap((r) => r.features);
    searchIndex = [
      ...FEATURES.map((f) => ({ kind: 'f', f, hay: [f.plainTitle, f.en, f.short, f.tags, text(f.tldr), f.se.map((s) => s.id + ' ' + s.id.slice(3)).join(' '), f.flag, 'swift ' + f.release, 'swift ' + f.since].join(' ').toLowerCase() })),
      ...D.proposals.map((p) => ({ kind: 'p', p, hay: (p.id + ' ' + p.id.slice(3) + ' ' + p.title + ' ' + (p.flag || '')).toLowerCase() })),
    ];
  }

  /** Load a language's bundle script on demand (works from file:// too). index.html lists each
   *  bundle's content fingerprint, so after a deploy the URL changes and no old cached copy is used. */
  function loadBundle(code) {
    if (BUNDLES[code]) return Promise.resolve(BUNDLES[code]);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const fp = window.SWIFT_CLUB_FINGERPRINTS?.[code];
      s.src = `assets/data.${code}.js` + (fp ? `?v=${fp}` : '');
      s.onload = () => (BUNDLES[code] ? resolve(BUNDLES[code]) : reject(new Error(`empty bundle: ${code}`)));
      s.onerror = () => reject(new Error(`cannot load ${s.src}`));
      document.head.append(s);
    });
  }

  const matchLang = (v) => {
    const s = String(v ?? '').toLowerCase();
    return s ? LANGS.find((l) => s === l.code || s.startsWith(l.code + '-') || s.startsWith(l.code + '_'))?.code ?? null : null;
  };
  /** ?lang=zh in the URL wins, then the saved choice, then the default language. */
  const requestedLang = () => matchLang(new URLSearchParams(location.search).get('lang')) || matchLang(store.get('lang', null)) || DEFAULT_LANG;

  /** Keep the address bar in step with the language so copied links open in the same language. */
  function syncUrl(code) {
    try {
      const u = new URL(location.href);
      if (code === DEFAULT_LANG) u.searchParams.delete('lang'); else u.searchParams.set('lang', code);
      history.replaceState(history.state, '', u);
    } catch { /* e.g. restricted file:// URLs */ }
  }

  /** Update everything outside <main> that carries text. */
  function applyLang() {
    document.documentElement.lang = D.htmlLang;
    document.title = t('meta.title');
    const desc = $('meta[name="description"]');
    if (desc) desc.setAttribute('content', t('meta.description'));
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    for (const [attr, target] of [['data-i18n-aria', 'aria-label'], ['data-i18n-ph', 'placeholder'], ['data-i18n-title', 'title']]) {
      $$(`[${attr}]`).forEach((el) => el.setAttribute(target, t(el.getAttribute(attr))));
    }
    renderNav();
    renderFoot();
    renderLangSwitch();
  }

  function renderLangSwitch() {
    $('#langSeg').innerHTML = LANGS.map((l) => `<button type="button" data-lang="${esc(l.code)}" lang="${esc(l.htmlLang)}" aria-pressed="${l.code === lang}" title="${esc(l.name)}">${esc(l.short)}</button>`).join('');
  }

  async function switchLang(code) {
    if (!ready || code === lang) return;
    const keep = captureScroll();
    try { await loadBundle(code); } catch { toast(t('lang.failed')); return; }
    useBundle(code);
    store.set('lang', code);
    syncUrl(code);
    applyLang();
    hideTip();
    currentView = '';              // force the current view to render again
    route();
    restoreScroll(keep);
  }

  function captureScroll() {
    const cur = $('.strip li.current');
    return { feature: cur ? cur.dataset.id : null, y: window.scrollY };
  }
  function restoreScroll(s) {
    if (s.feature && document.getElementById('f-' + s.feature)) scrollToFeature(s.feature);
    else window.scrollTo(0, s.y);
  }

  function setLearned(id, on) {
    if (on) learned.add(id); else learned.delete(id);
    store.set('learned', [...learned]);
    $$(`[data-punch="${id}"]`).forEach((b) => paintPunch(b, on));
    $$(`.strip li[data-id="${id}"]`).forEach((li) => li.classList.toggle('done', on));
    if (on) toast(t('toast.punched', { title: FMAP.get(id).plainTitle }));
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ───────────────────────── Swift syntax highlighting ─────────────────────────
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

  function tokenizeOther(src, kind) {
    const out = [];
    const kw = kind === 'shell'
      ? /^(swift|swiftc|build|package|test|migrate|sdk|install|show-traits)$/
      : /^(void|int|double|float|char|unsigned|typedef|enum|struct|return|const|static|if|else|interface|end|implementation|property|nonatomic|strong|SWIFT_EXTERN|SWIFT_ENUM|SWIFT_NOEXCEPT|SWIFT_WARN_UNUSED_RESULT)$/;
    const re = kind === 'shell'
      ? /(#.*$)|("[^"\n]*"|'[^'\n]*')|(\b\d+\b)|(--?[\w-]+)|([\w.-]+)|([\s\S])/gm
      : /(\/\/.*$|\/\*[\s\S]*?\*\/)|("[^"\n]*")|(\b\d+\b)|(@\w+|#\w+)|([A-Za-z_]\w*)|([\s\S])/gm;
    let m;
    while ((m = re.exec(src))) {
      if (m[1]) out.push(['c', m[1]]);
      else if (m[2]) out.push(['s', m[2]]);
      else if (m[3]) out.push(['n', m[3]]);
      else if (m[4]) out.push([kind === 'shell' ? 'a' : 'k', m[4]]);
      else if (m[5]) out.push([kw.test(m[5]) ? 'k' : /^[A-Z]/.test(m[5]) && kind !== 'shell' ? 't' : null, m[5]]);
      else out.push([null, m[6]]);
    }
    return out;
  }

  function highlightLines(code, kind) {
    const tokens = kind === 'swift' ? tokenizeSwift(code) : kind === 'text' ? [[null, code]] : tokenizeOther(code, kind);
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

  // ───────────────────────── Compiler output ─────────────────────────
  const sevClass = (w) => (w === 'error' ? 't-err' : w === 'warning' ? 't-warn' : 't-note');

  function renderTerm(src) {
    const docs = new Map();
    const body = [];
    for (const line of String(src).split('\n')) {
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
    return html + (links ? `<div class="term-docs"><span>${esc(t('term.docs'))}</span>${links}</div>` : '');
  }

  const cmdText = (r) => (r.command || 'swiftc main.swift').replace('{testing}', t('code.testing'));
  const cleanTerm = () => `<span class="t-ok">${esc(t('code.clean'))}</span>`;
  const codeStore = new Map();
  let codeSeq = 0;

  function codeFigure(b, opts = {}) {
    const lines = highlightLines(b.code, b.lang);
    const hl = opts.hlSet || parseHl(b.hl);
    const body = lines.map((l, i) => `<span class="ln${hl.has(i + 1) ? ' hl' : ''}" data-n="${i + 1}">${l || ' '}</span>`).join('');
    const id = 'c' + ++codeSeq;
    codeStore.set(id, b.code);
    const r = opts.noResult ? null : b.result;
    const badgeOf = (cls, key) => `<span class="badge ${cls}">${esc(t(key))}</span>`;
    let badge = '';
    if (!opts.noResult) {
      if (b.check === 'none') {
        const label = b.lang === 'swift' ? t('code.badge.sketch') : { shell: t('code.lang.shell'), c: 'C', objc: 'Objective-C', text: t('code.lang.text') }[b.lang] || b.lang;
        badge = `<span class="badge none">${esc(label)}</span>`;
      }
      else if (!r || r.status === 'skipped') badge = badgeOf('none', 'code.badge.unverified');
      else if (b.check === 'run') badge = r.status === 'warning' ? badgeOf('warning', 'code.badge.ranWarn') : badgeOf('ok', 'code.badge.ran');
      else badge = { ok: badgeOf('ok', 'code.badge.ok'), warning: badgeOf('warning', 'code.badge.warning'), error: badgeOf('error', 'code.badge.error') }[r.status] || '';
    }
    const title = b.title || (b.file ? `<span class="code-file">${esc(b.file)}</span>` : '');
    let tail = '';
    if (r && r.status !== 'skipped') {
      tail += `<div class="code-cmd">$ ${esc(cmdText(r))}</div>`;
      if (r.diagnostics) tail += `<pre class="term">${renderTerm(r.diagnostics)}</pre>`;
      else if (b.check !== 'run') tail += `<pre class="term">${cleanTerm()}</pre>`;
      if (b.check === 'run') tail += `<pre class="term"><span class="term-label">${esc(t('code.output'))}</span>${esc(r.output || t('code.noOutput'))}</pre>`;
    }
    return `<figure class="code${opts.nolines ? ' nolines' : ''}${opts.bare ? ' bare' : ''}"${opts.attrs || ''}>
      <figcaption class="code-head"><span class="code-title">${title}</span>${badge}<button class="copy-btn" type="button" data-copy="${id}">${esc(t('code.copy'))}</button></figcaption>
      <pre class="src"><code>${body}</code></pre>${tail}</figure>`;
  }

  // ───────────────────────── Content blocks ─────────────────────────
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

  const punchLabel = (on) => t(on ? 'punch.on' : 'punch.off');

  function paintPunch(btn, on) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    $('.punch-label', btn).textContent = punchLabel(on);
  }

  function punchButton(id) {
    const on = learned.has(id);
    return `<button class="punch" type="button" data-punch="${id}" aria-pressed="${on}"><span class="hole"></span><span class="punch-label">${esc(punchLabel(on))}</span></button>`;
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
    const since = f.since !== f.release ? `<span class="chip">${esc(t('feature.since', { version: f.since }))}</span>` : '';
    // The flag chip links to the basics station that explains upcoming-feature flags, when there is one.
    const flagHelp = f.id !== FLAG_HELP && FMAP.has(FLAG_HELP);
    const flag = f.flag ? `<${flagHelp ? `a href="#f-${FLAG_HELP}"` : 'span'} class="chip flag" title="${esc(t('feature.flagTip'))}">${esc(f.flag)}</${flagHelp ? 'a' : 'span'}>` : '';
    return `<article class="feature" id="f-${f.id}" data-line="${f.line}" data-id="${f.id}">
      <div class="f-top">
        <span class="f-line"><span class="bullet sm">${f.line}</span>${esc(line.name)}</span>
        <span class="chip level-${f.level}">${esc(levelName(f.level))}</span>${since}${seChips(f)}${flag}
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

  // ───────────────────────── Router ─────────────────────────
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
    const rel = ZONES.map((r) => `<a href="#${r.id}" data-key="${r.id}"${r.prelude ? ` class="pre" title="${esc(t('prelude.navTitle'))}"` : ''}><span class="v">${r.version}</span></a>`).join('');
    $('#nav').innerHTML = `<a href="#map" data-key="map">${esc(t('nav.map'))}</a><span class="sep"></span>${rel}<span class="sep"></span>
      <a href="#labs" data-key="labs">${esc(t('nav.labs'))}</a><a href="#quiz" data-key="quiz">${esc(t('nav.quiz'))}</a><a href="#index" data-key="index">${esc(t('nav.index'))}</a><a href="#pass" data-key="pass">${esc(t('nav.pass'))}</a>`;
  }

  function route() {
    if (!ready) return;
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

  // ───────────────────────── Home ─────────────────────────
  function lastFeature() { const id = store.get('last', null); return FMAP.get(id) || null; }

  function viewHome() {
    const verified = D.meta.verified;
    const last = lastFeature();
    const total = NEWF.length;
    const v0 = RELEASES[0].version, v1 = RELEASES[RELEASES.length - 1].version;
    main.innerHTML = `
    <section class="hero">
      <div class="wrap hero-grid">
        <div>
          <div class="eyebrow">Swift ${v0} → ${v1} · ${esc(fmtDate(RELEASES[0].date, 'month'))} – ${esc(fmtDate(RELEASES[RELEASES.length - 1].date, 'month'))}</div>
          <h1>Swift <span class="ver">${v0} → ${v1}</span><br>${esc(t('home.title'))}</h1>
          <p class="hero-lead">${esc(t('home.lead'))}</p>
          <div class="hero-cta">
            ${last ? `<a class="btn primary" href="#f-${last.id}">${esc(t('home.continue', { title: last.short }))} →</a><a class="btn" href="#v60">${esc(t('home.startAt', { version: v0 }))}</a>`
                   : `<a class="btn primary" href="#v60">${esc(t('home.startAt', { version: v0 }))} →</a>`}
            <a class="btn" href="#lab-concurrency">${esc(t('home.tryLab'))}</a>
          </div>
          ${PRELUDE ? `<a class="hero-pre" href="#${PRELUDE.id}"><span class="pre-dot" aria-hidden="true"></span><span>${th('home.prelude', { n: PRELUDE.features.length, version: PRELUDE.version })} →</span></a>` : ''}
        </div>
        <div>
          <div class="stats">
            <div class="stat"><b>${RELEASES.length}</b><span>${esc(t('home.stat.releases', { range: `${v0}–${v1}` }))}</span></div>
            <div class="stat"><b>${total}</b><span>${esc(t('home.stat.stations'))}</span></div>
            <div class="stat"><b>${verified}</b><span>${esc(t('home.stat.verified'))}</span></div>
            <div class="stat"><b>${D.proposals.length}</b><span>${esc(t('home.stat.proposals'))}</span></div>
          </div>
          <p class="verify-note"><span class="dot"></span><span>${th('home.verify', { version: (/Swift version [\d.]+/.exec(D.meta.compiler) || [D.meta.compiler])[0] })}</span></p>
        </div>
      </div>
    </section>
    <section class="map-band" aria-label="${esc(t('home.mapAria'))}">
      <div class="wrap map-tools">
        <div class="map-legend" id="legend">${D.lines.map((l) => `<button type="button" data-line="${l.id}" data-toggle="${l.id}" aria-pressed="false"><span class="bullet sm">${l.id}</span>${esc(l.name)}</button>`).join('')}</div>
        <span class="hint"><span class="hint-mouse">${esc(t('home.hint.mouse'))}</span><span class="hint-touch">${esc(t('home.hint.touch'))}</span> · ${esc(t('home.hint.filled'))}</span>
      </div>
      <div class="map-scroll" id="mapScroll"></div>
    </section>
    <section class="section">
      <div class="wrap">
        <div class="section-head"><div><div class="eyebrow">${esc(t('home.routes.eyebrow'))}</div><h2>${esc(t('home.routes.title'))}</h2></div><p>${esc(t('home.routes.lead'))}</p></div>
        <div class="routes">${D.routes.map(routeCard).join('')}</div>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <div class="section-head"><div><div class="eyebrow">${esc(t('home.board.eyebrow'))}</div><h2>${esc(t('home.board.title'))}</h2></div><p>${esc(t('home.board.lead'))}</p></div>
        <div class="board">${ZONES.map(boardRow).join('')}</div>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <div class="section-head"><div><div class="eyebrow">${esc(t('home.labs.eyebrow'))}</div><h2>${esc(t('home.labs.title'))}</h2></div><p>${esc(t('home.labs.lead'))}</p></div>
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
    // A warmup is one line of the prelude zone (route A: the concurrency basics); it starts at that line's first station.
    const warm = r.warmup ? ZONES.find((z) => z.prelude && z.version === r.warmup.zone) : null;
    const warmStops = warm ? warm.features.map((id) => FMAP.get(id)).filter((f) => f.line === r.warmup.line) : [];
    return `<article class="route">
      <div class="route-head"><span class="route-badge">${esc(r.id)}</span><h3>${esc(r.name)}</h3></div>
      <p class="who">${esc(r.who)}</p>
      ${warmStops.length ? `<a class="route-pre" href="#f-${warmStops[0].id}"><span class="pre-dot" aria-hidden="true"></span><span>${esc(t('route.warmup', { ask: r.warmup.ask, n: warmStops.length, version: warm.version }))} →</span></a>` : ''}
      <ol class="route-stops">${stops.map((f) => `<li class="${learned.has(f.id) ? 'done' : ''}" data-line="${f.line}"><span class="stop-dot"></span><a href="#f-${f.id}">${esc(f.short)}</a><span class="stop-ver">${f.release}</span></li>`).join('')}</ol>
      <div class="route-foot"><span>${esc(r.time)} · ${esc(t('route.done', { done, total: stops.length }))}</span><a class="btn small" href="#f-${nextStop.id}">${esc(t(done ? 'route.continue' : 'route.start'))} →</a></div>
    </article>`;
  }

  function boardRow(r) {
    const feats = r.features.map((id) => FMAP.get(id));
    const lines = [...new Set(feats.map((f) => f.line))].sort();
    const done = feats.filter((f) => learned.has(f.id)).length;
    return `<a class="board-row${r.prelude ? ' pre' : ''}" href="#${r.id}">
      <span class="board-ver">${r.version}</span>
      <span class="board-date">${esc(r.prelude ? t('prelude.years') : fmtDate(r.date))}<span>${esc(r.subtitle)}</span></span>
      <span class="board-title"><b>${esc(r.title)}</b><span>${esc(t(r.prelude ? 'board.basics' : 'board.features', { n: feats.length }))} · ${lines.map((l) => `<span class="bullet sm" data-line="${l}" style="display:inline-grid;vertical-align:-3px;margin-right:2px">${l}</span>`).join('')}</span></span>
      <span class="board-prog"><span>${esc(t('board.punched', { done, total: feats.length }))}</span><span class="meter"><i style="width:${(done / feats.length) * 100}%"></i></span></span>
      <span class="board-go" aria-hidden="true">→</span>
    </a>`;
  }

  function labCards() {
    return `<div class="lab-cards">
      <a class="lab-card" href="#lab-concurrency"><div class="lab-art">${artLanes()}</div><h3>${esc(t('labCard.concurrency.title'))}</h3><p>${esc(t('labCard.concurrency.desc'))}</p><span class="go">${esc(t('labCard.enter'))} →</span></a>
      <a class="lab-card" href="#lab-ownership"><div class="lab-art">${artTicket()}</div><h3>${esc(t('labCard.ownership.title'))}</h3><p>${esc(t('labCard.ownership.desc'))}</p><span class="go">${esc(t('labCard.enter'))} →</span></a>
      <a class="lab-card" href="#lab-memory"><div class="lab-art">${artBytes()}</div><h3>${esc(t('labCard.memory.title'))}</h3><p>${esc(t('labCard.memory.desc'))}</p><span class="go">${esc(t('labCard.enter'))} →</span></a>
      <a class="lab-card" href="#quiz"><div class="lab-art">${artQuiz()}</div><h3>${esc(t('labCard.quiz.title'))}</h3><p>${esc(t('labCard.quiz.desc', { n: D.challenges.length, version: swiftVersion() }))}</p><span class="go">${esc(t('labCard.start'))} →</span></a>
    </div>`;
  }
  const artLanes = () => `<svg width="150" height="70" viewBox="0 0 150 70" aria-hidden="true"><line x1="40" y1="8" x2="40" y2="62" stroke="var(--l1)" stroke-width="4" stroke-linecap="round"/><line x1="110" y1="8" x2="110" y2="62" stroke="var(--l2)" stroke-width="4" stroke-linecap="round"/><path d="M40 22 L110 34 L40 50" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="4 4"/><circle cx="40" cy="22" r="6" fill="var(--surface)" stroke="var(--l1)" stroke-width="3"/><circle cx="110" cy="34" r="6" fill="var(--surface)" stroke="var(--l2)" stroke-width="3"/><circle cx="40" cy="50" r="6" fill="var(--l1)"/></svg>`;
  const artTicket = () => `<svg width="150" height="70" viewBox="0 0 150 70" aria-hidden="true"><rect x="22" y="16" width="106" height="40" rx="7" fill="var(--surface)" stroke="var(--l4)" stroke-width="2.5"/><line x1="92" y1="18" x2="92" y2="54" stroke="var(--l4)" stroke-width="2" stroke-dasharray="3 3"/><text x="34" y="41" font-size="15" font-weight="800" fill="var(--ink)" font-family="Overpass, sans-serif">No.1</text><circle cx="110" cy="36" r="7" fill="var(--l4)"/></svg>`;
  const artBytes = () => { let s = '<svg width="150" height="70" viewBox="0 0 150 70" aria-hidden="true">'; for (let k = 0; k < 32; k++) { const x = 14 + (k % 16) * 7.8, y = 18 + Math.floor(k / 16) * 18; const c = k < 8 ? 'var(--ink-3)' : k < 24 ? 'var(--l2)' : 'var(--rule)'; s += `<rect x="${x}" y="${y}" width="6" height="14" rx="1.5" fill="${c}"/>`; } return s + '</svg>'; };
  const artQuiz = () => `<svg width="150" height="70" viewBox="0 0 150 70" aria-hidden="true"><circle cx="40" cy="35" r="14" fill="var(--ok-soft)"/><path d="M33 35l5 5 9-10" stroke="var(--ok)" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="75" cy="35" r="14" fill="var(--warn-soft)"/><text x="75" y="41" text-anchor="middle" font-size="17" font-weight="900" fill="var(--warn)">!</text><circle cx="110" cy="35" r="14" fill="var(--err-soft)"/><path d="M104 29l12 12M116 29l-12 12" stroke="var(--err)" stroke-width="3" stroke-linecap="round"/></svg>`;

  // ───────────── Line map (SVG) ─────────────
  let mapCompact = null;
  let dimLine = 0;

  /** Long line names wrap onto two rows in the map's left gutter. */
  function splitLabel(name, max) {
    if (name.length <= max || !name.includes(' ')) return [name];
    const words = name.split(' ');
    let best = 1, bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
      if (diff < bestDiff) { best = i; bestDiff = diff; }
    }
    return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
  }
  /** Rough rendered width of a short label (CJK glyphs are about twice as wide as Latin ones). */
  const labelWidth = (s, latin, cjk) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? cjk : latin), 0);

  function drawMap() {
    const box = $('#mapScroll');
    if (!box) return;
    const compact = window.innerWidth < 720;
    if (compact === mapCompact && box.firstChild && box.dataset.lang === lang) return;
    mapCompact = compact;
    box.dataset.lang = lang;
    const STEP = compact ? 35 : 43, ROW = compact ? 86 : 98, TOP = compact ? 70 : 80, GUT = compact ? 150 : 186, PAD = compact ? 16 : 22;
    const grid = ZONES.map((r) => {
      const by = {};
      for (const id of r.features) { const f = FMAP.get(id); (by[f.line] ||= []).push(f); }
      return by;
    });
    // A column is as wide as its busiest line needs, and never narrower than its "Sep 2024 · 15 stations" caption.
    // The prelude column says "Before you board · 15 stations" instead of a date.
    const caption = (r) => `${r.prelude ? r.subtitle : fmtDate(r.date, 'month')} · ${t('map.stations', { n: r.features.length })}`;
    const colW = grid.map((by, i) => Math.max(
      Math.max(2, ...D.lines.map((l) => (by[l.id] || []).length)) * STEP + PAD * 2,
      Math.ceil(labelWidth(caption(ZONES[i]), 6.1, 12)) + PAD + 10,
    ));
    const firstRel = ZONES.findIndex((r) => !r.prelude);   // tracks turn solid where the releases begin
    const colX = [];
    let x = GUT;
    for (const w of colW) { colX.push(x); x += w; }
    const W = x + (compact ? 78 : 104);
    const H = TOP + D.lines.length * ROW + 10;
    const rowY = (l) => TOP + (l - 1) * ROW + Math.round(ROW * 0.7);
    const last = store.get('last', null);
    const hereText = t('map.here');
    const hereW = Math.round(16 + labelWidth(hereText, 6.4, 11));
    let s = `<svg class="map-svg${dimLine ? ' dimmed' : ''}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(t('map.aria', { from: RELEASES[0].version, to: RELEASES[RELEASES.length - 1].version }))}">`;
    if (PRELUDE) s += '<defs><pattern id="preHatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hatch-bg" width="10" height="10"/><line class="hatch" x1="0" y1="0" x2="0" y2="10"/></pattern></defs>';
    ZONES.forEach((r, i) => {
      if (r.prelude) s += `<rect class="zone pre" x="${colX[i]}" y="0" width="${colW[i]}" height="${H}"/>`;
      else if ((i - firstRel) % 2 === 0) s += `<rect class="zone" x="${colX[i]}" y="0" width="${colW[i]}" height="${H}"/>`;
      s += `<a class="ver-link${r.prelude ? ' pre' : ''}" href="#${r.id}" aria-label="Swift ${r.version}${r.prelude ? ` · ${esc(r.subtitle)}` : ''}"><text class="ver-label" x="${colX[i] + PAD - 4}" y="${compact ? 30 : 36}">${r.version}</text><text class="ver-date" x="${colX[i] + PAD - 3}" y="${compact ? 48 : 56}">${esc(caption(r))}</text></a>`;
    });
    for (const line of D.lines) {
      const y = rowY(line.id);
      const nameRows = splitLabel(line.name, compact ? 11 : 14);
      const nameStyle = compact ? ' style="font-size:12.5px"' : '';
      s += `<g class="row${dimLine === line.id ? ' on' : ''}" data-line="${line.id}">`;
      if (firstRel > 0) {
        // Through the prelude zone the line is dotted: it began before 6.0, but that part isn't "new".
        s += `<path class="track pre" d="M${GUT - 14} ${y} H${colX[firstRel]}" stroke="var(--l${line.id})"/>`;
        s += `<path class="track" d="M${colX[firstRel]} ${y} H${W - 34}" stroke="var(--l${line.id})"/>`;
      } else {
        s += `<path class="track" d="M${GUT - 14} ${y} H${W - 34}" stroke="var(--l${line.id})"/>`;
      }
      s += `<g class="line-group" data-toggle="${line.id}" tabindex="0" role="button" aria-label="${esc(t('map.onlyLine', { name: line.name }))}">
        <circle cx="${compact ? 18 : 24}" cy="${y - 7}" r="${compact ? 11 : 13}" fill="var(--l${line.id})"/>
        <text class="line-num" x="${compact ? 18 : 24}" y="${y - 2}" text-anchor="middle" fill="var(--l${line.id}-on)">${line.id}</text>
        <text class="line-name" x="${compact ? 34 : 44}" y="${y - 3}"${nameStyle}>${esc(nameRows[0])}</text>
        ${nameRows[1] ? `<text class="line-name" x="${compact ? 34 : 44}" y="${y + (compact ? 12 : 14)}"${nameStyle}>${esc(nameRows[1])}</text>` : ''}
        ${!nameRows[1] && !compact && line.en ? `<text class="line-en" x="44" y="${y + 14}">${esc(line.en)}</text>` : ''}
      </g>`;
      ZONES.forEach((r, i) => {
        const list = grid[i][line.id] || [];
        const inner = colW[i] - PAD * 2;
        list.forEach((f, k) => {
          const sx = Math.round(colX[i] + PAD + (k + 0.5) * (inner / list.length));
          const rad = f.level === 'core' ? 8.5 : f.level === 'brief' ? 5.8 : 7.2;
          s += `<a class="station ${f.level}${r.prelude ? ' pre' : ''}${learned.has(f.id) ? ' done' : ''}" href="#f-${f.id}" data-id="${f.id}" style="--c: var(--l${line.id})">
            <title>${esc(f.plainTitle)}</title>
            <circle cx="${sx}" cy="${y}" r="${rad}" stroke="var(--l${line.id})"/>
            <text class="label" transform="translate(${sx + 3} ${y - rad - 7}) rotate(-38)">${esc(f.short)}</text>
          </a>`;
          if (f.id === last) {
            s += `<g aria-hidden="true"><rect class="here-bg" x="${sx - hereW / 2}" y="${y + 13}" width="${hereW}" height="18" rx="9"/><text class="here" x="${sx}" y="${y + 26}" text-anchor="middle">${esc(hereText)}</text></g>`;
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
    tip.innerHTML = `<div class="tip-head"><span class="bullet sm" data-line="${f.line}">${f.line}</span>${esc(line.name)} · Swift ${esc(f.since)} · ${esc(levelName(f.level))}</div><b>${esc(f.plainTitle)}</b><p>${esc(text(f.tldr))}</p>`;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 16, top = y + 16;
    if (left + w > window.innerWidth - 12) left = x - w - 16;
    if (top + h > window.innerHeight - 12) top = y - h - 16;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { const tip = $('#tip'); if (tip) tip.hidden = true; }

  // ───────────────────────── Release page ─────────────────────────
  function viewRelease(rel, focusId) {
    const feats = rel.features.map((id) => FMAP.get(id));
    const byLine = {};
    feats.forEach((f) => { byLine[f.line] = (byLine[f.line] || 0) + 1; });
    const idx = ZONES.indexOf(rel);
    const next = ZONES[idx + 1];
    main.innerHTML = `
      <section class="rel-head${rel.prelude ? ' pre' : ''}">
        <div class="wrap rel-head-grid">
          <div class="rel-ver">${rel.version}<small>${esc(rel.subtitle)}</small></div>
          <div class="rel-meta">
            <div class="eyebrow">${esc(rel.prelude ? t('prelude.eyebrow', { n: feats.length }) : t('rel.eyebrow', { version: rel.version, date: fmtDate(rel.date), n: feats.length }))}</div>
            <h1>${esc(rel.title)}</h1>
            <p class="summary">${rel.summary}</p>
            <div class="rel-facts">
              ${Object.keys(byLine).sort().map((l) => `<span class="chip" data-line="${l}"><span class="bullet sm">${l}</span>${esc(LINES.get(+l).name)} ${byLine[l]}</span>`).join('')}
              ${rel.blog ? `<a class="chip" href="${esc(rel.blog)}" target="_blank" rel="noopener">${esc(t(rel.prelude ? 'prelude.book' : 'rel.notes'))} ↗</a>` : ''}
            </div>
          </div>
        </div>
      </section>
      <div class="wrap rel-body">
        <nav class="strip" aria-label="${esc(t('rel.stripAria'))}">
          <p class="strip-title"><span>${esc(t('rel.strip', { version: rel.version }))}</span><span>${feats.filter((f) => learned.has(f.id)).length}/${feats.length}</span></p>
          <ol>${feats.map((f) => `<li data-id="${f.id}" data-line="${f.line}" class="${f.level === 'brief' ? 'brief' : ''}${learned.has(f.id) ? ' done' : ''}" style="--c: var(--l${f.line})"><a href="#f-${f.id}"><span class="sdot"></span><span class="s-name">${esc(f.short)}</span></a></li>`).join('')}</ol>
        </nav>
        <div class="rel-content">
          ${feats.map(featureArticle).join('')}
          <div class="next-rel">
            ${next ? `<div><div class="eyebrow">${esc(t('rel.next'))}</div><b style="font-size:18px">Swift ${next.version} · ${esc(next.title)}</b></div><a class="btn primary" href="#${next.id}">${esc(t('rel.goNext', { version: next.version }))} →</a>`
                   : `<div><div class="eyebrow">${esc(t('rel.end'))}</div><b style="font-size:18px">${esc(t('rel.endNote'))}</b></div><a class="btn primary" href="#quiz">${esc(t('rel.endCta'))} →</a>`}
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

  // ───────────────────────── Labs: index ─────────────────────────
  function viewLabs() {
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow">${esc(t('labs.eyebrow'))}</div><h1>${esc(t('labs.title'))}</h1>
        <p>${esc(t('labs.lead', { version: swiftVersion() }))}</p></section>
      <div class="wrap">${labCards()}</div>`;
  }

  // ───────────────────────── Lab: concurrency trace ─────────────────────────
  function viewLabConcurrency() {
    const modes = ['concurrency-classic', 'concurrency-nonsending', 'concurrency-concurrent'].map((id) => D.labs[id]).filter(Boolean);
    let mode = 0, step = -1, timer = null;
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow"><span class="bullet sm" data-line="1" style="vertical-align:-3px">1</span> ${esc(t('lab.eyebrow', { line: LINES.get(1).name }))}</div>
        <h1>${esc(t('lab.conc.title'))}</h1>
        <p>${th('lab.conc.lead')}</p></section>
      <div class="wrap">
        <div class="seg" id="modeSeg" role="group" aria-label="${esc(t('lab.conc.modes'))}">${modes.map((m, i) => `<button type="button" data-mode="${i}" aria-pressed="${i === 0}">${m.title}<small>${text(m.note)}</small></button>`).join('')}</div>
        <div class="lab" style="margin-top:16px">
          <div class="panel"><div class="panel-head"><span>main.swift</span><code id="flagLbl" style="font-size:11.5px"></code></div><div id="labCode"></div></div>
          <div class="panel">
            <div class="panel-head"><span>${esc(t('lab.conc.trace'))}</span>
              <div class="lab-controls">
                <button class="btn small" type="button" id="stPrev">← ${esc(t('lab.conc.prev'))}</button>
                <button class="btn small primary" type="button" id="stPlay">▶ ${esc(t('lab.conc.play'))}</button>
                <button class="btn small" type="button" id="stNext">${esc(t('lab.conc.next'))} →</button>
                <button class="btn small" type="button" id="stReset">${esc(t('lab.reset'))}</button>
              </div>
            </div>
            <div class="lanes"><div class="lane-head main lane-col"><i></i>${esc(t('lab.conc.laneMain'))}</div><div class="lane-head pool"><i></i>${esc(t('lab.conc.lanePool'))}</div></div>
            <div class="trace" id="trace"></div>
            <div class="step-say" id="stepSay" aria-live="polite"></div>
          </div>
        </div>
        <div class="verdict" id="verdict"></div>
        <div class="cmp" id="cmp"></div>
      </div>`;

    const codeLines = (m) => m.code.split('\n');
    const chipText = (m, st) => {
      if (st.lane === 'out') return esc(t('lab.conc.hopOut'));
      if (st.lane === 'in') return esc(t('lab.conc.hopIn'));
      const line = codeLines(m).find((l) => l.includes(st.mark)) || '';
      const codeOnly = line.replace(/\/\/.*$/, '').trim();
      return `<span class="mk">${esc(st.mark)}</span><code>${esc(codeOnly)}</code>${st.lane === 'wait' ? ` · ${esc(t('lab.conc.suspended'))}` : ''}`;
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
        ? esc(t('lab.conc.idle'))
        : th('lab.conc.step', { step: step + 1, total: m.steps.length, text: raw(m.steps[step].text) });
      $('#stPrev').disabled = step < 0;
      $('#stNext').disabled = step >= m.steps.length - 1;
    }

    function paintVerdict() {
      const m = modes[mode];
      const r = m.result;
      const ok = r.status === 'ok';
      $('#verdict').innerHTML = `<div class="verdict-head"><h3>${esc(t('lab.verdict.title'))}</h3><span class="badge ${ok ? 'ok' : 'error'}">${esc(t(ok ? 'code.badge.ok' : 'code.badge.error'))}</span><span class="muted" style="font-size:13px">${esc(t('lab.verdict.note', { version: swiftVersion() }))}</span></div>
        <div class="code-cmd" style="border-radius:var(--radius) var(--radius) 0 0">$ ${esc(cmdText(r))}</div>
        <pre class="term" style="border-radius:0 0 var(--radius) var(--radius)">${r.diagnostics ? renderTerm(r.diagnostics) : cleanTerm()}</pre>`;
    }

    function paintCmp() {
      $('#cmp').innerHTML = modes.map((m, i) => {
        const hops = m.steps.filter((s) => s.lane === 'out' || s.lane === 'in').length;
        const ok = m.result.status === 'ok';
        return `<div style="${i === mode ? 'border-color:var(--ink)' : ''}"><b>${m.title}</b>${esc(t('lab.cmp.hops', { n: hops }))} · ${ok ? `<span style="color:var(--ok)">${esc(t('code.badge.ok'))}</span>` : `<span style="color:var(--err)">${esc(t('lab.cmp.error'))}</span>`}<br><span class="muted">${m.cmp || ''}</span></div>`;
      }).join('');
    }

    function paint() { paintCode(); paintTrace(); }
    function stop() { clearInterval(timer); timer = null; $('#stPlay').textContent = '▶ ' + t('lab.conc.play'); }
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
      $('#stPlay').textContent = '❚❚ ' + t('lab.conc.pause');
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

  // ───────────────────────── Lab: ownership sandbox ─────────────────────────
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
      { code: 'inspect(a)', run: () => borrow('a'), tip: t('sandbox.tip.borrow') },
      { code: 'let b = a', run: () => move('a', 'b'), tip: t('sandbox.tip.move') },
      { code: 'inspect(b)', run: () => borrow('b'), tip: t('sandbox.tip.borrow') },
      { code: 'a.punch()', run: () => punch('a'), tip: t('sandbox.tip.punch') },
      { code: 'b.punch()', run: () => punch('b'), tip: t('sandbox.tip.punch') },
      { code: 'let c = copy a', run: () => copyOp('a', 'c'), tip: t('sandbox.tip.copy') },
    ];

    const goneText = (v) => t(`sandbox.gone.${v.gone}`, { to: v.goneTo });
    const fail = (code, message, why) => { S.log.push({ code, status: 'rejected' }); S.msg = { kind: 'bad', message, why }; };
    function need(name, code) {
      const v = S.vars[name];
      if (!v.declared) { fail(code, `cannot find '${name}' in scope`, t('sandbox.why.undeclared', { name })); return null; }
      return v;
    }
    function borrow(name) {
      const code = `inspect(${name})`;
      const v = need(name, code); if (!v) return;
      if (!v.ticket) { fail(code, withName(MSG.used, name), t('sandbox.why.borrowGone', { name, gone: goneText(v) })); return; }
      S.log.push({ code, status: 'ok' });
      S.msg = { kind: 'ok', why: t('sandbox.ok.borrow', { name, no: v.ticket.no }) };
      S.flash = name;
    }
    function move(from, to) {
      const code = `let ${to} = ${from}`;
      const v = need(from, code); if (!v) return;
      if (S.vars[to].declared) { fail(code, `invalid redeclaration of '${to}'`, t('sandbox.why.redeclared', { to, reset: t('lab.reset') })); return; }
      if (!v.ticket) { fail(code, withName(MSG.twice, from), t('sandbox.why.moveGone', { from, gone: goneText(v) })); return; }
      if (copyable) {
        S.vars[to] = { declared: true, ticket: { no: v.ticket.no, dup: true, punched: v.ticket.punched }, gone: '' };
        S.log.push({ code, status: 'copied' });
        S.msg = { kind: 'warn', why: t('sandbox.warn.copyMove', { to, no: v.ticket.no }) };
      } else {
        S.vars[to] = { declared: true, ticket: v.ticket, gone: '' };
        v.ticket = null; v.gone = 'moved'; v.goneTo = to;
        S.log.push({ code, status: 'ok' });
        S.msg = { kind: 'ok', why: t('sandbox.ok.move', { from, to }) };
      }
    }
    function punch(name) {
      const code = `${name}.punch()`;
      const v = need(name, code); if (!v) return;
      if (!v.ticket) { fail(code, withName(MSG.twice, name), t('sandbox.why.punchGone', { name, gone: goneText(v) })); return; }
      if (copyable) {
        const again = v.ticket.punched;
        v.ticket = { ...v.ticket, punched: true };
        S.log.push({ code, status: again ? 'copied' : 'ok' });
        S.msg = again
          ? { kind: 'warn', why: t('sandbox.warn.punchTwice') }
          : { kind: 'ok', why: t('sandbox.ok.punchCopyable', { name }) };
      } else {
        v.ticket = null; v.gone = 'punched';
        S.log.push({ code, status: 'ok' });
        S.msg = { kind: 'ok', why: t('sandbox.ok.punch', { name }) };
      }
    }
    function copyOp(from, to) {
      const code = `let ${to} = copy ${from}`;
      if (!copyable) { fail(code, MSG.copy, t('sandbox.why.noCopy')); return; }
      const v = need(from, code); if (!v) return;
      if (S.vars[to].declared) { fail(code, `invalid redeclaration of '${to}'`, t('sandbox.why.redeclared', { to, reset: t('lab.reset') })); return; }
      if (!v.ticket) { fail(code, withName(MSG.used, from), t('sandbox.why.copyGone', { from })); return; }
      S.vars[to] = { declared: true, ticket: { no: v.ticket.no, dup: true, punched: v.ticket.punched }, gone: '' };
      S.log.push({ code, status: 'copied' });
      S.msg = { kind: 'warn', why: t('sandbox.warn.copyOp', { no: v.ticket.no }) };
    }

    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow"><span class="bullet sm" data-line="2" style="vertical-align:-3px">2</span> ${esc(t('lab.eyebrow', { line: LINES.get(2).name }))}</div>
        <h1>${esc(t('sandbox.title'))}</h1>
        <p>${th('sandbox.lead')}</p></section>
      <div class="wrap">
        <div class="seg" id="ownSeg" role="group" aria-label="${esc(t('sandbox.typeAria'))}">
          <button type="button" data-copyable="0" aria-pressed="true">struct Ticket: ~Copyable<small>${esc(t('sandbox.noncopyable'))}</small></button>
          <button type="button" data-copyable="1" aria-pressed="false">struct Ticket<small>${esc(t('sandbox.copyable'))}</small></button>
        </div>
        <div class="lab" style="margin-top:16px">
          <div class="panel">
            <div class="panel-head"><span>${esc(t('sandbox.vars'))}</span><button class="btn small" type="button" id="ownReset">${esc(t('lab.reset'))}</button></div>
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
        <p class="muted" style="font-size:13px;margin-top:12px">${th('sandbox.note', { version: swiftVersion(), msg: MSG.used })}</p>
      </div>`;

    function paint() {
      $('#slots').innerHTML = ['a', 'b', 'c'].map((name) => {
        const v = S.vars[name];
        let inner;
        if (!v.declared) inner = `<div class="ghost">${esc(t('sandbox.slot.undeclared'))}</div>`;
        else if (v.ticket) inner = `<div class="ticket${v.ticket.punched ? ' punched' : ''}${v.ticket.dup ? ' dup' : ''}${S.flash === name ? ' flash' : ''}"><b>No.${v.ticket.no}</b>${esc(t(v.ticket.dup ? 'sandbox.ticket.copy' : 'sandbox.ticket.single'))}${v.ticket.punched ? esc(t('sandbox.ticket.punched')) : ''}</div>`;
        else inner = `<div class="ghost">${th('sandbox.ghost', { gone: goneText(v) })}</div>`;
        const tag = !v.declared ? '' : t(v.ticket ? 'sandbox.slot.holds' : 'sandbox.slot.dead');
        return `<div class="slot${v.declared ? ' declared' : ''}"><div class="slot-name"><span>${name}</span><span class="muted">${esc(tag)}</span></div>${inner}</div>`;
      }).join('');
      S.flash = null;
      const code = (copyable ? 'struct Ticket {\n' : 'struct Ticket: ~Copyable {\n') + '    let id: Int\n    consuming func punch() { }\n}\nfunc inspect(_ t: borrowing Ticket) { }\n\n' + S.log.map((l) => l.code).join('\n');
      $('#ownCode').innerHTML = codeFigure({ code, lang: 'swift' }, { noResult: true, bare: true, attrs: ' data-log="1"' }).replace('class="code bare"', 'class="code bare code-log"');
      const offset = 6;
      S.log.forEach((l, i) => {
        const ln = $(`#ownCode .ln[data-n="${i + offset + 1}"]`);
        if (ln && l.status !== 'ok') ln.classList.add(l.status === 'rejected' ? 'rejected' : 'copied');
      });
      $('#ownSig').textContent = copyable ? t('sandbox.sig.copyable') : '~Copyable';
      const m = S.msg;
      $('#ownMsg').innerHTML = !m ? `<div class="callout">${th('sandbox.hint')}</div>`
        : m.kind === 'bad' ? `<div class="callout bad"><b>${esc(t('sandbox.rejected'))}</b><pre class="term" style="margin:8px 0;border-radius:8px"><span class="t-err">error:</span> ${esc(m.message)}</pre>${esc(m.why)}</div>`
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

  // ───────────────────────── Lab: memory layout ─────────────────────────
  function viewLabMemory() {
    const table = D.labs['memory-table']?.table || [];
    let ti = Math.max(0, table.findIndex((r) => r.name === 'Int'));
    let n = 4;
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow"><span class="bullet sm" data-line="2" style="vertical-align:-3px">2</span> ${esc(t('lab.eyebrow', { line: LINES.get(2).name }))}</div>
        <h1>${esc(t('mem.title'))}</h1>
        <p>${th('mem.lead', { version: swiftVersion() })}</p></section>
      <div class="wrap">
        <div class="mem-controls">
          <div class="seg" id="memType" role="group" aria-label="${esc(t('mem.typeAria'))}">${table.map((r, i) => `<button type="button" data-t="${i}" aria-pressed="${i === ti}"><code style="background:none;border:0;padding:0">${esc(r.name)}</code></button>`).join('')}</div>
          <label for="memN">${esc(t('mem.count'))} <input id="memN" type="range" min="1" max="8" value="${n}"> <b id="memNv" class="num">${n}</b></label>
        </div>
        <div class="mem-grid" id="memGrid"></div>
        <div class="legend-row">
          <span><i class="byte ptr"></i>${esc(t('mem.legend.ptr'))}</span><span><i class="byte hdr"></i>${esc(t('mem.legend.hdr'))}</span>
          <span data-line="2"><i class="byte el"></i>${esc(t('mem.legend.el'))}</span><span><i class="byte pad"></i>${esc(t('mem.legend.pad'))}</span><span><i class="byte cnt"></i>${esc(t('mem.legend.cnt'))}</span>
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
    const fact = (labelKey, value) => `<li>${esc(t(labelKey))}<b>${esc(value)}</b></li>`;
    const times = (n) => t('mem.times', { n });

    function paint() {
      const row = table[ti];
      if (!row) { $('#memGrid').innerHTML = `<p>${esc(t('mem.empty'))}</p>`; return; }
      const els = elementCells(row);
      const inlineSize = row.inline[n - 1];
      const arrayHeap = 32 + n * row.stride;
      $('#memGrid').innerHTML = `
        <section class="mem-card" data-line="2">
          <h3>[${esc(row.name)}]<span>Array</span></h3>
          <div class="mem-area"><span>${esc(t('mem.onStack'))}</span><span>${esc(t('mem.bytes', { n: row.array }))}</span></div>
          ${dump(Array(row.array).fill('ptr'))}
          <div class="mem-arrow">${esc(t('mem.arrow.heap'))}</div>
          <div class="mem-area"><span>${esc(t('mem.onHeap'))}</span><span>${esc(t('mem.heapSize', { n, stride: row.stride, total: arrayHeap }))}</span></div>
          ${dump([...Array(32).fill('hdr'), ...els])}
          <ul class="mem-facts"><li>MemoryLayout.size<b>${row.array}</b></li>${fact('mem.f.alloc', times(1))}${fact('mem.f.cow', t('mem.has'))}${fact('mem.f.growable', t('mem.yes'))}</ul>
        </section>
        <section class="mem-card" data-line="2">
          <h3>[${n} of ${esc(row.name)}]<span>InlineArray</span></h3>
          <div class="mem-area"><span>${esc(t('mem.onStack'))}</span><span>${n}×${row.stride} = ${esc(t('mem.bytes', { n: inlineSize }))}</span></div>
          ${dump(els)}
          <ul class="mem-facts"><li>MemoryLayout.size<b>${inlineSize}</b></li>${fact('mem.f.alloc', times(0))}${fact('mem.f.cow', t('mem.hasNot'))}${fact('mem.f.growable', t('mem.fixed'))}${fact('mem.f.copy', t('mem.copyAll', { n: inlineSize }))}</ul>
        </section>
        <section class="mem-card" data-line="2">
          <h3>Span&lt;${esc(row.name)}&gt;<span>Span</span></h3>
          <div class="mem-area"><span>${esc(t('mem.onStackOnly'))}</span><span>${esc(t('mem.bytes', { n: row.span }))}</span></div>
          ${dump([...Array(8).fill('ptr'), ...Array(Math.max(0, row.span - 8)).fill('cnt')])}
          <div class="mem-arrow">${esc(t('mem.arrow.span'))}</div>
          <ul class="mem-facts"><li>MemoryLayout.size<b>${row.span}</b></li>${fact('mem.f.alloc', times(0))}${fact('mem.f.refcount', t('mem.none'))}${fact('mem.f.lifetime', t('mem.lifetime'))}${fact('mem.f.copy', t('mem.copyView'))}</ul>
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

  // ───────────────────────── Guess the Compiler ─────────────────────────
  function viewQuiz() {
    const qs = D.challenges;
    let i = 0;
    const results = [];
    const LABEL = { ok: t('code.badge.ok'), warning: t('code.badge.warning'), error: t('code.badge.error') };
    const num = (v) => raw(`<b class="num">${esc(v)}</b>`);
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow">${esc(t('quiz.eyebrow'))}</div><h1>${esc(t('quiz.title'))}</h1>
        <p>${esc(t('quiz.lead', { n: qs.length, version: swiftVersion() }))}</p></section>
      <div class="wrap quiz-stage" id="qstage"></div>`;

    function paintQuestion() {
      const q = qs[i];
      const best = store.get('quizBest', null);
      $('#qstage').innerHTML = `
        <div class="qhud"><span>${th('quiz.hud', { i: num(i + 1), n: qs.length, c: num(results.filter(Boolean).length) })}${best != null ? ` · ${esc(t('quiz.best', { best, n: qs.length }))}` : ''}</span>
          <span class="qdots">${qs.map((_, k) => `<i class="${k < results.length ? (results[k] ? 'right' : 'wrong') : k === i ? 'now' : ''}"></i>`).join('')}</span></div>
        <div class="qcard">
          <div class="f-top" style="margin:0"><span class="chip">${esc(q.topic)}</span><code style="font-size:11.5px">${esc(q.flags)}</code></div>
          <h2>${q.title}</h2>
          ${codeFigure({ code: q.code, lang: 'swift' }, { noResult: true })}
          <div class="qchoices" id="qchoices">
            <button type="button" data-v="ok"><span class="sym">✓</span>${esc(t('code.badge.ok'))}<small>${esc(t('quiz.choice.ok'))}</small></button>
            <button type="button" data-v="warning"><span class="sym">!</span>${esc(t('code.badge.warning'))}<small>${esc(t('quiz.choice.warning'))}</small></button>
            <button type="button" data-v="error"><span class="sym">✕</span>${esc(t('code.badge.error'))}<small>${esc(t('quiz.choice.error'))}</small></button>
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
          <div class="verdict-line ${right ? 'right' : 'wrong'}">${esc(right ? t('quiz.result.right') : t('quiz.result.wrong', { answer: LABEL[q.answer] }))}</div>
          <div><div class="code-cmd" style="border-radius:var(--radius) var(--radius) 0 0">$ swiftc ${esc(q.flags)} main.swift</div>
          <pre class="term" style="border-radius:0 0 var(--radius) var(--radius)">${q.diagnostics ? renderTerm(q.diagnostics) : cleanTerm()}</pre></div>
          <p>${q.explain}</p>
          <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center">
            ${rel ? `<a class="chip" href="#f-${rel.id}">${esc(t('quiz.related', { title: rel.plainTitle }))} →</a>` : '<span></span>'}
            <button class="btn primary" type="button" id="qnext">${esc(i < qs.length - 1 ? t('quiz.next') + ' →' : t('quiz.finish'))}</button>
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
      const msg = t(score === qs.length ? 'quiz.final.perfect' : score >= qs.length * 0.75 ? 'quiz.final.great' : score >= qs.length * 0.5 ? 'quiz.final.good' : 'quiz.final.retry');
      $('#qstage').innerHTML = `<div class="qcard qfinal">
        <div class="eyebrow">${esc(t('quiz.final.eyebrow'))}</div><div class="big num">${score}<span style="font-size:28px;color:var(--ink-3)">/${qs.length}</span></div>
        <p>${esc(msg)}</p>
        ${wrong.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">${wrong.map((q) => { const f = FMAP.get(q.related); return f ? `<a class="chip" href="#f-${f.id}">${esc(f.short)}</a>` : ''; }).join('')}</div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><button class="btn primary" type="button" id="qagain">${esc(t('quiz.final.again'))}</button><a class="btn" href="#pass">${esc(t('quiz.final.pass'))}</a></div>
      </div>`;
      $('#qagain').addEventListener('click', () => { i = 0; results.length = 0; paintQuestion(); });
    }
    paintQuestion();
  }

  // ───────────────────────── All proposals ─────────────────────────
  function viewIndex() {
    const P = D.proposals;
    const verOf = (p) => (p.version ? p.version : 'pending');
    const versions = ['all', '6.0', '6.1', '6.2', '6.2.3', '6.3', '6.4', '6.5', 'pending'];
    const VLABEL = { all: t('index.v.all'), pending: t('index.v.pending'), '6.5': t('index.v.65') };
    const STATE = { accepted: t('index.state.accepted'), activeReview: t('index.state.activeReview'), acceptedWithRevisions: t('index.state.acceptedWithRevisions'), scheduledForReview: t('index.state.scheduledForReview'), implemented: t('index.state.implemented') };
    let fv = 'all', fl = 0, q = '';
    const in65 = P.filter((p) => p.version === '6.5');
    const examples = in65.slice(0, 4).map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title.replace(/`/g, ''))}</a>`).join(esc(t('list.sep')));
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow">${esc(t('index.eyebrow'))}</div><h1>${esc(t('index.title'))}</h1>
        <p>${esc(t('index.lead', { n: P.length, date: D.meta.evolutionDate }))}</p></section>
      <div class="wrap">
        <div class="next-station">
          <div class="big">6.5</div>
          <div><b>${esc(t('index.next.title'))}</b><p class="muted" style="margin-top:4px">${th('index.next.body', { n: in65.length, examples: raw(examples) })}</p></div>
        </div>
        <div class="filters">
          <div class="filter-row" id="fVer"><span class="lbl">${esc(t('index.f.version'))}</span>${versions.map((v) => `<button type="button" data-v="${v}" aria-pressed="${v === fv}">${esc(VLABEL[v] || v)}</button>`).join('')}</div>
          <div class="filter-row" id="fLine"><span class="lbl">${esc(t('index.f.line'))}</span><button type="button" data-l="0" aria-pressed="true">${esc(t('index.v.all'))}</button>${D.lines.map((l) => `<button type="button" data-l="${l.id}" data-line="${l.id}" aria-pressed="false"><span class="bullet sm">${l.id}</span>${esc(l.name)}</button>`).join('')}</div>
          <div class="filter-row"><span class="lbl">${esc(t('index.f.search'))}</span><input class="text-filter" id="fText" type="search" placeholder="${esc(t('index.f.placeholder'))}"></div>
        </div>
        <p class="count-line" id="pCount"></p>
        <div class="table-wrap"><table class="ptable"><thead><tr><th>${esc(t('index.col.id'))}</th><th>${esc(t('index.col.title'))}</th><th>${esc(t('index.col.version'))}</th><th>${esc(t('index.col.line'))}</th><th>${esc(t('index.col.lesson'))}</th></tr></thead><tbody id="pBody"></tbody></table></div>
      </div>`;

    function paint() {
      const qq = q.trim().toLowerCase();
      const rows = P.filter((p) => (fv === 'all' || verOf(p) === fv) && (!fl || p.line === fl)
        && (!qq || p.title.toLowerCase().includes(qq) || p.id.toLowerCase().includes(qq) || (p.flag || '').toLowerCase().includes(qq)))
        .sort((a, b) => (verOf(a) === verOf(b) ? a.id.localeCompare(b.id) : verOf(a).localeCompare(verOf(b), 'en', { numeric: true })));
      $('#pCount').textContent = t('index.count', { n: rows.length });
      $('#pBody').innerHTML = rows.map((p) => {
        const f = FMAP.get(p.feature);
        const pend = !p.version;
        return `<tr class="${pend || p.version === '6.5' ? 'future' : ''}">
          <td class="id"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.id)}</a></td>
          <td><span class="ptitle">${esc(p.title.replace(/`/g, ''))}</span>${p.flag ? `<span class="flagname">${esc(p.flag)}</span>` : ''}</td>
          <td class="ver">${pend ? `<span class="chip">${esc(STATE[p.state] || p.state)}</span>` : esc(p.version)}</td>
          <td><span class="bullet sm" data-line="${p.line}" title="${esc(LINES.get(p.line).name)}">${p.line}</span></td>
          <td>${f ? `<a href="#f-${f.id}">${esc(f.short)} →</a>` : '<span class="muted">—</span>'}</td></tr>`;
      }).join('') || `<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">${esc(t('index.none'))}</td></tr>`;
    }
    $('#fVer').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; fv = b.dataset.v; $$('#fVer button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint(); });
    $('#fLine').addEventListener('click', (e) => { const b = e.target.closest('button[data-l]'); if (!b) return; fl = +b.dataset.l; $$('#fLine button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint(); });
    $('#fText').addEventListener('input', (e) => { q = e.target.value; paint(); });
    paint();
  }

  // ───────────────────────── My pass ─────────────────────────
  function viewPass() {
    // The pass covers the new features (6.0 → 6.4); the 5.x basics get their own row of holes.
    const total = NEWF.length;
    const done = NEWF.filter((f) => learned.has(f.id)).length;
    const pct = Math.round((done / total) * 100);
    const best = store.get('quizBest', null);
    main.innerHTML = `
      <section class="wrap page-head"><div class="eyebrow">${esc(t('pass.eyebrow'))}</div><h1>${esc(t('pass.title'))}</h1>
        <p>${esc(t('pass.lead'))}</p></section>
      <div class="wrap pass-grid">
        <div>
          <div class="card" aria-label="${esc(t('pass.cardAria', { pct }))}">
            <div class="card-top"><div><b>${esc(t('brand.name'))}</b><span>${esc(t('pass.cardName', { from: RELEASES[0].version, to: RELEASES[RELEASES.length - 1].version }))}</span></div><svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="var(--brand)"/><path d="M8.5 21 L14.5 14.5 H23.5" fill="none" stroke="var(--brand-on)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8.5" cy="21" r="3.3" fill="var(--brand-on)"/><circle cx="23.5" cy="14.5" r="3.3" fill="var(--brand-on)"/></svg></div>
            <div class="card-pct num">${pct}%<small>${esc(t('pass.punched', { done, total }))}</small></div>
            <div class="card-bottom"><span>${esc(t('pass.firstRide', { date: fmtDate(firstRide) }))}</span><span>${esc(t('pass.quizBest', { best: best == null ? '—' : `${best}/${D.challenges.length}` }))}</span></div>
            <div class="card-stripes" aria-hidden="true">${D.lines.map((l) => { const fs = NEWF.filter((f) => f.line === l.id); const d = fs.filter((f) => learned.has(f.id)).length; return `<i style="--c: var(--l${l.id})"><b style="width:${(d / fs.length) * 100}%"></b></i>`; }).join('')}</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
            <a class="btn primary" href="${(() => { const f = NEWF.find((x) => !learned.has(x.id)); return f ? '#f-' + f.id : '#quiz'; })()}">${esc(t(done < total ? 'pass.next' : 'pass.allDone'))} →</a>
            <button class="btn" type="button" id="resetBtn">${esc(t('pass.clear'))}</button>
          </div>
        </div>
        <div>
          <h2 style="font-family:var(--font-display);font-size:20px;margin-bottom:14px">${esc(t('pass.byLine'))}</h2>
          <div class="lines-prog">${D.lines.map((l) => {
            const fs = NEWF.filter((f) => f.line === l.id);
            const d = fs.filter((f) => learned.has(f.id)).length;
            return `<div class="lp-row" data-line="${l.id}"><span class="bullet">${l.id}</span><div><div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(l.name)}</span></div><div class="meter"><i style="width:${(d / fs.length) * 100}%"></i></div></div><span class="num">${d}/${fs.length}</span></div>`;
          }).join('')}</div>
          <div class="punch-grid">${ZONES.map((r) => `<div class="pg-row${r.prelude ? ' pre' : ''}"><a class="pg-ver" href="#${r.id}"${r.prelude ? ` title="${esc(r.subtitle)}"` : ''}>${r.version}</a><div class="pg-holes">${r.features.map((id) => { const f = FMAP.get(id); return `<a href="#f-${f.id}" data-line="${f.line}" class="${learned.has(f.id) ? 'done' : ''}" style="border-color:var(--c);${learned.has(f.id) ? 'background:var(--c)' : ''}" title="${esc(f.plainTitle)}" aria-label="${esc(f.plainTitle)}${learned.has(f.id) ? esc(t('pass.punchedSuffix')) : ''}"></a>`; }).join('')}</div></div>`).join('')}</div>
          ${PRELUDE ? `<p class="pg-note">${esc(t('pass.preludeNote', { version: PRELUDE.version }))}</p>` : ''}
        </div>
      </div>`;
    let armed = false, armTimer;
    $('#resetBtn').addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (!armed) { armed = true; b.textContent = t('pass.clearConfirm'); b.style.borderColor = 'var(--err)'; armTimer = setTimeout(() => { armed = false; b.textContent = t('pass.clear'); b.style.borderColor = ''; }, 3000); return; }
      clearTimeout(armTimer);
      learned = new Set(); store.set('learned', []); store.set('quizBest', null); store.set('last', null);
      toast(t('toast.cleared'));
      viewPass();
    });
    cleanup.push(() => clearTimeout(armTimer));
  }

  // ───────────────────────── Search ─────────────────────────
  let active = 0;
  function openSearch() {
    if (!ready) return;
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
    if (!terms.length) hits = searchIndex.filter((x) => x.kind === 'f' && x.f.level === 'core');
    else {
      hits = searchIndex.filter((x) => terms.every((term) => x.hay.includes(term)));
      const score = (x) => (x.kind === 'f' ? 0 : 10) + (x.kind === 'f' && terms.some((term) => x.f.plainTitle.toLowerCase().includes(term)) ? 0 : 3);
      hits.sort((a, b) => score(a) - score(b));
    }
    const fs = hits.filter((x) => x.kind === 'f').slice(0, 12);
    const ps = hits.filter((x) => x.kind === 'p').slice(0, terms.length ? 8 : 0);
    active = 0;
    const li = (href, bullet, title, sub, ext) => `<li><a href="${href}"${ext ? ' target="_blank" rel="noopener"' : ''}>${bullet}<span class="sr-main"><b>${title}</b><span>${sub}</span></span></a></li>`;
    $('#searchResults').innerHTML = (!fs.length && !ps.length) ? `<li class="empty">${esc(t('search.empty'))}</li>`
      : (fs.length ? `<li class="group">${esc(t(terms.length ? 'search.group.features' : 'search.group.core'))}</li>` : '') + fs.map((x) => li(`#f-${x.f.id}`, `<span class="bullet sm" data-line="${x.f.line}">${x.f.line}</span>`, `${esc(x.f.plainTitle)} <span class="muted" style="display:inline;font-weight:400">· ${x.f.since}</span>`, esc(text(x.f.tldr)))).join('')
        + (ps.length ? `<li class="group">${esc(t('search.group.proposals'))}</li>` : '') + ps.map((x) => li(x.p.url, `<span class="chip mono" style="flex:none">${esc(x.p.id)}</span>`, esc(x.p.title.replace(/`/g, '')), x.p.version ? `Swift ${esc(x.p.version)}` : esc(x.p.state), true)).join('');
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

  // ───────────────────────── Theme ─────────────────────────
  const savedTheme = store.get('theme', null);
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.setAttribute('data-theme', savedTheme);
  $('#themeBtn').addEventListener('click', () => {
    const attr = document.documentElement.getAttribute('data-theme');
    const dark = attr ? attr === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('theme', next);
    if (ready) toast(t(next === 'dark' ? 'theme.dark' : 'theme.light'));
  });

  // ───────────────────────── Language switch ─────────────────────────
  $('#langSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (b) switchLang(b.dataset.lang);
  });

  // ───────────────────────── Global event delegation ─────────────────────────
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
      ex.innerHTML = `<b style="color:var(${pick === qz.answer ? '--ok' : '--err'})">${esc(t(pick === qz.answer ? 'quiz.right' : 'quiz.wrong'))}</b> ${qz.explain}`;
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const code = codeStore.get(copy.dataset.copy) || '';
      const done = () => { copy.textContent = t('code.copied'); setTimeout(() => { copy.textContent = t('code.copy'); }, 1400); };
      const fallback = () => {
        const pre = copy.closest('.code')?.querySelector('pre');
        if (!pre) return;
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        copy.textContent = t('code.selected');
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

  // ───────────────────────── Footer & start-up ─────────────────────────
  function renderFoot() {
    $('#foot').innerHTML = `<div class="wrap foot-grid">
    <div><p>${th('foot.about')}</p>
    <p>${th('foot.verified', { compiler: D.meta.compiler, date: D.meta.builtAt })}</p></div>
    <div><p>${esc(t('foot.trademark'))}</p><p>${th('foot.storage', { kbd: raw('<span class="kbd">/</span>') })}</p></div>
  </div>`;
  }

  async function boot() {
    const want = requestedLang();
    let code = want;
    try { await loadBundle(want); } catch { code = DEFAULT_LANG; }
    useBundle(code);
    learned = new Set(store.get('learned', []).filter((id) => FMAP.has(id)));
    firstRide = store.get('first', null);
    if (!firstRide) { firstRide = new Date().toISOString().slice(0, 10); store.set('first', firstRide); }
    ready = true;
    applyLang();
    window.addEventListener('hashchange', route);
    route();
    if (code !== want) toast(t('lang.failed'));
  }
  boot();
})();
