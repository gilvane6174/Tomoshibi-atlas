// 過去の記録の一覧（データベース）。手動で掲載した情報を、表示から外れたものも含めて、年・分野・国・言葉で絞り込んで見られる。
// データは組み立て時に作る data/archive.json（手動掲載のみ。自動取得の情報は保存していない）。
// 文字はすべて textContent で入れ、リンクは https だけを使う（innerHTML は使わない）。
const isEn = document.documentElement.lang === 'en';
const PAGE = 50;
const NAMES = isEn
  ? { research: 'Research & Response', care: 'Mental health & Welfare', crime: 'Crime prevention', disaster: 'Disasters' }
  : { research: '研究と対策', care: 'こころと福祉', crime: '防犯', disaster: '防災' };
const SUB = isEn ? { mental: 'Mental health', welfare: 'Welfare' } : { mental: 'こころ', welfare: '福祉' };
const T = isEn
  ? { all: 'All', count: (n, total) => `${n} of ${total} items`, more: 'Show more', none: 'No items match.', published: 'Published', checked: 'Source checked', open: 'Open the original', error: 'The archive could not be loaded. Please reload the page later.', jaOnly: '(Japanese only)' }
  : { all: 'すべて', count: (n, total) => `${total}件中 ${n}件`, more: 'さらに表示', none: '条件に合う記録はありません。', published: '公表', checked: '原典確認', open: '原典を開く', error: '記録を読み込めませんでした。時間をおいて再読み込みしてください。', jaOnly: '' };
const fmt = (iso) => (iso ? new Intl.DateTimeFormat(isEn ? 'en-GB' : 'ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso)) : '—');
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const pick = (o) => (o ? (isEn ? o.en || o.ja || '' : o.ja || o.en || '') : '');
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

async function start() {
  const out = document.getElementById('archive-list');
  const countEl = document.getElementById('archive-count');
  try {
    const [doc, geo] = await Promise.all([fetch('data/archive.json', { cache: 'no-cache' }).then((r) => r.json()), fetch('data/geo/country-index.json').then((r) => r.json())]);
    const cname = new Map(geo.map((c) => [c.id, isEn ? c.enName || c.en?.[0] || c.id : c.ja]));
    const items = Array.isArray(doc.items) ? doc.items : [];
    const layerSel = document.getElementById('f-layer');
    const yearSel = document.getElementById('f-year');
    const countrySel = document.getElementById('f-country');
    const q = document.getElementById('f-q');
    const opt = (sel, value, label) => sel.append(Object.assign(el('option', null, label), { value }));
    opt(layerSel, '', T.all);
    for (const [k, v] of Object.entries(NAMES)) if (items.some((it) => it.layer === k)) opt(layerSel, k, v);
    opt(yearSel, '', T.all);
    for (const y of [...new Set(items.map((it) => it.publishedAt.slice(0, 4)))].sort().reverse()) opt(yearSel, y, isEn ? y : `${y}年`);
    opt(countrySel, '', T.all);
    const countries = [...new Set(items.flatMap((it) => it.countries))].map((id) => [id, cname.get(id) || id]).sort((a, b) => a[1].localeCompare(b[1], isEn ? 'en' : 'ja'));
    for (const [id, name] of countries) opt(countrySel, id, name);

    // 前回の絞り込みを、URL の ?layer=…&year=…&country=… から復元する（個人に関わる情報は入れない）
    const params = new URLSearchParams(location.search);
    for (const [sel, key] of [[layerSel, 'layer'], [yearSel, 'year'], [countrySel, 'country']]) {
      const v = params.get(key);
      if (v && [...sel.options].some((o) => o.value === v)) sel.value = v;
    }

    let shown = PAGE;
    const filtered = () => {
      const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      return items.filter((it) => {
        if (layerSel.value && it.layer !== layerSel.value) return false;
        if (yearSel.value && !it.publishedAt.startsWith(yearSel.value)) return false;
        if (countrySel.value && !it.countries.includes(countrySel.value)) return false;
        if (!words.length) return true;
        const hay = [it.title?.ja, it.title?.en, it.summary?.ja, it.summary?.en, it.source?.name, ...it.countries.map((c) => cname.get(c) || c)].join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    };
    const render = () => {
      const list = filtered();
      out.replaceChildren();
      countEl.textContent = T.count(Math.min(shown, list.length), list.length);
      if (!list.length) out.append(el('p', 'empty', T.none));
      for (const it of list.slice(0, shown)) {
        const art = el('article', 'archive-item');
        const meta = el('p', 'archive-meta', `${NAMES[it.layer] || it.layer}${it.sub ? `（${SUB[it.sub]}）` : ''}　${T.published} ${fmt(it.publishedAt)}　${it.countries.map((c) => cname.get(c) || c).join('・')}`);
        const title = pick(it.title);
        art.append(meta, el('h3', null, title));
        const sum = pick(it.summary);
        if (it.attribution) art.append(el('p', 'archive-attr', pick(it.attribution)));
        if (sum) art.append(el('p', null, sum));
        const foot = el('p', 'archive-foot', `${T.checked} ${fmt(it.checkedAt)}　`);
        const url = safeUrl(it.source?.url);
        if (url) {
          const a = el('a', 'text-link', `${T.open}: ${it.source.name}`);
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          foot.append(a);
        }
        art.append(foot);
        out.append(art);
      }
      if (list.length > shown) {
        const b = el('button', 'text-btn archive-more', T.more);
        b.type = 'button';
        b.addEventListener('click', () => {
          shown += PAGE;
          render();
        });
        out.append(b);
      }
      try {
        const u = new URL(location.href);
        for (const [sel, key] of [[layerSel, 'layer'], [yearSel, 'year'], [countrySel, 'country']]) (sel.value ? u.searchParams.set(key, sel.value) : u.searchParams.delete(key));
        history.replaceState(null, '', u.pathname.split('/').pop() + u.search);
      } catch {
        /* URL を変えられない環境では何もしない */
      }
    };
    for (const c of [layerSel, yearSel, countrySel]) c.addEventListener('change', () => ((shown = PAGE), render()));
    q.addEventListener('input', () => ((shown = PAGE), render()));
    render();
  } catch {
    out.replaceChildren(el('p', 'empty', T.error));
  }
}
start();
