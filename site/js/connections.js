// 「情報のつながりを見る」ページ：運用者が選んだテーマごとに、掲載中の情報（手動掲載）を2Dの図と一覧で並べる。
// データは組み立て時に作る data/connections.json（元は data/curated/connections.json。検査は scripts/validate-data.mjs）。
// つながりは「同じテーマで並べた」という意味だけで、情報どうしの因果関係（原因・結果）は示さない。
// 図は SVG を createElementNS で組み立て、文字はすべて textContent で入れる（innerHTML は使わない）。外部への通信はしない。
import { natureBadge } from './nature.js';

const isEn = document.documentElement.lang === 'en';
const lang = isEn ? 'en' : 'ja';
const SVG = 'http://www.w3.org/2000/svg';
const LAYER = {
  research: ['#6cc9b8', '研究と対策', 'Research & Response'],
  care: ['#b3a6ec', 'こころと福祉', 'Mental health & Welfare'],
  crime: ['#e58fcf', '防犯', 'Crime prevention'],
  disaster: ['#86b6ea', '防災', 'Disasters'],
};
const L = isEn
  ? { all: 'All themes', items: (n) => `${n} items`, published: 'Published', source: 'Original', alsoIn: 'Also in:', loadFail: 'The data could not be loaded. Please try again later.', graphAll: (t, n) => `Diagram of ${t} themes and ${n} items. The same content is listed below.`, graphOne: (t, n) => `Diagram of the theme “${t}” and its ${n} items. The same content is listed below.`, open: (t) => `Show the theme “${t}”`, pick: (n, t) => `Item ${n}: ${t}`, reviewed: (d) => `Themes last reviewed: ${d}`, chooseTheme: 'Choose a theme to see its items.' }
  : { all: 'すべてのテーマ', items: (n) => `${n}件`, published: '公表', source: '原典', alsoIn: 'ほかのテーマ：', loadFail: 'データを読み込めませんでした。時間をおいて、もう一度お試しください。', graphAll: (t, n) => `${t}のテーマと${n}件の情報の図。同じ内容を下に一覧で載せています。`, graphOne: (t, n) => `テーマ「${t}」と${n}件の情報の図。同じ内容を下に一覧で載せています。`, open: (t) => `テーマ「${t}」を表示`, pick: (n, t) => `${n}番：${t}`, reviewed: (d) => `テーマの最終確認：${d}`, chooseTheme: 'テーマを選ぶと、その情報の一覧が出ます。' };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const sv = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const pick = (o) => (o ? (isEn ? o.en || o.ja || '' : o.ja || o.en || '') : '');
const fmt = (iso) => (iso ? new Intl.DateTimeFormat(isEn ? 'en-GB' : 'ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso)) : '—');
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
// 長い名前を1行あたり n 文字（英語は語の区切り）で分ける。最大3行。省略はしない
function wrapText(text, n) {
  const out = [];
  if (isEn) {
    let line = '';
    for (const w of text.split(/\s+/)) {
      if (line && (line + ' ' + w).length > n) {
        out.push(line);
        line = w;
      } else line = line ? line + ' ' + w : w;
    }
    if (line) out.push(line);
  } else {
    // 括弧の前で切れるときは括弧から次の行へ
    const chars = [...text];
    let line = '';
    for (const c of chars) {
      if ([...line].length >= n || (c === '（' && [...line].length >= n - 3)) {
        out.push(line);
        line = '';
      }
      line += c;
    }
    if (line) out.push(line);
  }
  return out.length > 3 ? [...out.slice(0, 2), out.slice(2).join(isEn ? ' ' : '')] : out;
}
const color = (layer) => (LAYER[layer] || ['#93a0b0'])[0];
const layerName = (layer) => (LAYER[layer] ? LAYER[layer][isEn ? 2 : 1] : layer);

// キーボードでも押せる SVG の部品（role=button、Enter・スペースで反応）
function pressable(g, label, onPress) {
  g.setAttribute('tabindex', '0');
  g.setAttribute('role', 'button');
  g.setAttribute('aria-label', label);
  g.addEventListener('click', onPress);
  g.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress();
    }
  });
}

const state = { theme: null, active: null };

function render(doc, cname) {
  const themes = doc.themes;
  const byTheme = new Map(themes.map((t) => [t.id, t]));
  const themesOf = (id) => themes.filter((t) => t.items.includes(id));

  // テーマを選ぶボタン
  const tabs = document.getElementById('conn-tabs');
  tabs.replaceChildren();
  for (const [id, label] of [[null, L.all], ...themes.map((t) => [t.id, pick(t.title)])]) {
    const b = el('button', 'cmp-tab', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.theme === id));
    b.addEventListener('click', () => {
      state.theme = id;
      state.active = null;
      render(doc, cname);
    });
    tabs.append(b);
  }

  const theme = state.theme ? byTheme.get(state.theme) : null;
  const head = document.getElementById('conn-head');
  head.replaceChildren();
  if (theme) {
    head.append(el('h2', null, pick(theme.title)), el('p', null, pick(theme.summary)));
    if (theme.note) head.append(el('p', 'note', pick(theme.note)));
  } else head.append(el('h2', null, L.all), el('p', null, L.chooseTheme));

  // ── 図 ──
  const wrap = document.getElementById('conn-graph');
  const narrow = (wrap.clientWidth || 760) < 560;
  const svg = sv('svg', { class: 'conn-graph' + (theme ? '' : ' is-overview'), role: 'img' });
  const edges = sv('g');
  const nodes = sv('g');
  svg.append(edges, nodes);
  const go = (id) => {
    if (!theme) state.theme = themesOf(id)[0]?.id || null;
    state.active = id;
    render(doc, cname);
    document.getElementById('conn-item-' + id)?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  };
  const addNode = (x, y, id, label, text, r) => {
    const it = doc.items[id];
    const g = sv('g', { class: 'conn-node' + (state.active === id ? ' is-active' : '') });
    g.append(sv('circle', { cx: x, cy: y, r, fill: color(it?.layer) }));
    if (text) {
      const tx = sv('text', { x, y: y + 5, 'text-anchor': 'middle', fill: '#0a0f16', 'font-size': 14, 'font-weight': 700 });
      tx.textContent = text;
      g.append(tx);
    }
    const tip = sv('title');
    tip.textContent = pick(it?.title);
    g.append(tip);
    pressable(g, label, () => go(id));
    nodes.append(g);
  };
  // テーマ名を、はみ出さないよう複数行に分けて書く（省略しない）
  const labelText = (parent, x, y, text, size, perLine) => {
    const lines = wrapText(text, perLine);
    const t = sv('text', { x, y: y - ((lines.length - 1) * size * 1.25) / 2 + size * 0.35, 'text-anchor': 'middle', class: 'conn-hub-text', 'font-size': size });
    lines.forEach((ln, i) => {
      const sp = sv('tspan', { x, dy: i ? size * 1.25 : 0 });
      sp.textContent = ln;
      t.append(sp);
    });
    parent.append(t);
    return lines.length;
  };

  if (theme) {
    // 1つのテーマ：中心にテーマ（名前は円の中に複数行で）、まわりに情報（番号は下の一覧と同じ）
    const W = 800;
    const H = 560;
    const cx = W / 2;
    const cy = H / 2;
    const n = theme.items.length;
    const R = Math.min(215, 150 + n * 7);
    theme.items.forEach((id, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const x = cx + R * Math.cos(a);
      const y = cy + R * Math.sin(a);
      edges.append(sv('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'conn-edge' }));
      addNode(x, y, id, L.pick(i + 1, pick(doc.items[id]?.title)), String(i + 1), 19);
    });
    const g = sv('g');
    g.append(sv('circle', { cx, cy, r: 92, class: 'conn-hub' }));
    labelText(g, cx, cy, pick(theme.title), 17, isEn ? 16 : 9);
    nodes.append(g);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('aria-label', L.graphOne(pick(theme.title), n));
  } else {
    // すべてのテーマ：テーマごとの小さなまとまりを格子状に並べる（パソコン3列・スマートフォン2列）。
    // 情報は最初に属するテーマのまとまりに置き、ほかのテーマにも入る情報は、そのテーマの中心と点線で結ぶ
    const cols = narrow ? 2 : 3;
    const CW = 300;
    const CH = 230;
    const W = cols * CW;
    const H = Math.ceil(themes.length / cols) * CH;
    const fs = narrow ? 19 : 15;
    const hub = new Map();
    themes.forEach((t, i) => {
      const x0 = (i % cols) * CW;
      const y0 = Math.floor(i / cols) * CH;
      hub.set(t.id, [x0 + CW / 2, y0 + CH * 0.6, x0, y0]);
    });
    const home = new Map();
    for (const t of themes) for (const id of t.items) if (!home.has(id)) home.set(id, t.id);
    for (const t of themes) {
      const [hx, hy, x0, y0] = hub.get(t.id);
      const own = t.items.filter((id) => home.get(id) === t.id);
      const r = 62;
      own.forEach((id, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / Math.max(own.length, 1);
        const x = hx + r * Math.cos(a);
        const y = hy + r * Math.sin(a);
        edges.append(sv('line', { x1: hx, y1: hy, x2: x, y2: y, class: 'conn-edge' }));
        for (const other of themesOf(id).filter((o) => o.id !== t.id)) {
          const [ox, oy] = hub.get(other.id);
          edges.append(sv('line', { x1: ox, y1: oy, x2: x, y2: y, class: 'conn-edge conn-edge-also' }));
        }
        addNode(x, y, id, pick(doc.items[id]?.title), null, narrow ? 14 : 8);
      });
      const g = sv('g', { class: 'conn-hub-g' });
      g.append(sv('circle', { cx: hx, cy: hy, r: 16, class: 'conn-hub' }));
      labelText(g, hx, y0 + 34, pick(t.title), fs, isEn ? (narrow ? 22 : 28) : narrow ? 12 : 15);
      pressable(g, L.open(pick(t.title)), () => {
        state.theme = t.id;
        render(doc, cname);
      });
      nodes.append(g);
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('aria-label', L.graphAll(themes.length, Object.keys(doc.items).length));
  }
  wrap.replaceChildren(svg);

  // 凡例（分野の色。色だけに頼らないよう、一覧にも分野名を書く）
  const legend = document.getElementById('conn-legend');
  legend.replaceChildren();
  const usedLayers = new Set((theme ? theme.items : Object.keys(doc.items)).map((id) => doc.items[id]?.layer));
  for (const [k] of Object.entries(LAYER).filter(([k]) => usedLayers.has(k))) {
    const li = el('li');
    const dot = el('span', 'dot');
    dot.style.background = color(k);
    li.append(dot, document.createTextNode(layerName(k)));
    legend.append(li);
  }

  // ── 一覧 ──
  const list = document.getElementById('conn-list');
  list.replaceChildren();
  if (!theme) {
    for (const t of themes) {
      const li = el('li', 'conn-item');
      const h = el('h3');
      const b = el('button', 'text-btn', `${pick(t.title)}（${L.items(t.items.length)}）`);
      b.type = 'button';
      b.addEventListener('click', () => {
        state.theme = t.id;
        render(doc, cname);
      });
      h.append(b);
      li.append(h, el('p', null, pick(t.summary)));
      list.append(li);
    }
    return;
  }
  theme.items.forEach((id, i) => {
    const it = doc.items[id];
    if (!it) return;
    const li = el('li', 'conn-item' + (state.active === id ? ' is-active' : ''));
    li.id = 'conn-item-' + id;
    li.style.setProperty('--dot', color(it.layer));
    li.append(el('h3', null, `${i + 1}. ${pick(it.title)}`));
    const flags = el('p', 'entry-flags');
    flags.append(natureBadge(it, lang), el('span', 'badge', layerName(it.layer)));
    li.append(flags);
    const places = (it.countries || []).map((c) => cname.get(c)).filter(Boolean);
    li.append(el('p', null, `${L.published}: ${fmt(it.publishedAt)}${places.length ? (isEn ? ' · ' : '・') + places.join(isEn ? ', ' : '・') : ''}`));
    if (it.summary) li.append(el('p', null, (it.attribution ? pick(it.attribution) + (isEn ? ', ' : '、') : '') + pick(it.summary)));
    const href = safeUrl(it.source?.url);
    if (href) {
      const a = el('a', null, `${L.source}: ${it.source.name}`);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.referrerPolicy = 'no-referrer';
      li.append(el('p').appendChild(a).parentNode);
    }
    const others = themesOf(id).filter((t) => t.id !== theme.id);
    if (others.length) {
      const p = el('p', 'conn-also', L.alsoIn + ' ');
      others.forEach((t, k) => {
        const b = el('button', 'text-btn', pick(t.title));
        b.type = 'button';
        b.addEventListener('click', () => {
          state.theme = t.id;
          state.active = id;
          render(doc, cname);
        });
        if (k) p.append(document.createTextNode(isEn ? ', ' : '・'));
        p.append(b);
      });
      li.append(p);
    }
    list.append(li);
  });
}

(async () => {
  try {
    const [doc, geo] = await Promise.all([
      fetch('data/connections.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('load')))),
      fetch('data/geo/country-index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('load')))),
    ]);
    if (!Array.isArray(doc?.themes) || !doc.themes.length || !doc.items || typeof doc.items !== 'object') throw new Error('shape');
    const cname = new Map(geo.map((c) => [c.id, isEn ? c.enName || c.en?.[0] || c.id : c.ja]));
    // ?theme=… で開いたときは、そのテーマを表示する（一覧にある id だけ受け付ける）
    const q = new URLSearchParams(location.search).get('theme');
    if (q && doc.themes.some((t) => t.id === q)) state.theme = q;
    document.getElementById('conn-reviewed').textContent = L.reviewed(fmt(doc.reviewedAt));
    render(doc, cname);
    // 画面の幅がパソコンとスマートフォンの境目をまたいだら、図の並べ方を変える
    let wasNarrow = document.getElementById('conn-graph').clientWidth < 560;
    window.addEventListener('resize', () => {
      const now = document.getElementById('conn-graph').clientWidth < 560;
      if (now !== wasNarrow) {
        wasNarrow = now;
        render(doc, cname);
      }
    });
  } catch {
    document.getElementById('conn-list').replaceChildren(el('li', 'note', L.loadFail));
  }
})();
