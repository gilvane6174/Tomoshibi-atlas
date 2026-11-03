// 「世界をくらべる」ページ：組み立て時に世界銀行から取得した指標（data/compare.json）を、国ごとの表にする。
// 文字はすべて textContent で入れる。値の無い国は「データなし」と表示し、推計で埋めない。
// 外部への通信はしない（同じサイトの JSON だけを読む）。

import { NATURE_LABELS } from './nature.js';

const isEn = document.documentElement.lang === 'en';
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const pick = (o) => (isEn ? o?.en || o?.ja : o?.ja || o?.en) || '';
const L = isEn
  ? { country: 'Country / area', value: 'Value', year: 'Year', noData: 'No data', source: 'Source', withData: (n, all) => `${n} of ${all} countries and areas have data.`, notFetched: 'This preview has not retrieved the figures (they are retrieved when the site is published).', failed: 'The figures could not be retrieved in the latest update. Please check the source page.', retrieved: (d) => `Retrieved: ${d}`, sortV: 'Sort by value', sortN: 'Sort by name', loadFail: 'The data could not be loaded. Please try again later.' }
  : { country: '国・地域', value: '値', year: '年', noData: 'データなし', source: '出典', withData: (n, all) => `${all}の国・地域のうち、${n}に値があります。`, notFetched: 'この確認版では値を取得していません（公開時に取得します）。', failed: '最新の更新で値を取得できませんでした。出典のページでご確認ください。', retrieved: (d) => `取得：${d}`, sortV: '値の順に並べる', sortN: '名前の順に並べる', loadFail: 'データを読み込めませんでした。時間をおいて、もう一度お試しください。' };

function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
const fmt = (v, ind) => {
  const s = new Intl.NumberFormat(isEn ? 'en-GB' : 'ja-JP', { maximumFractionDigits: ind.decimals, minimumFractionDigits: ind.decimals }).format(v);
  return ind.unit === '%' ? `${s}%` : ind.unit === 'intl$' ? (isEn ? `$${s}` : `${s}国際ドル`) : s;
};
const fmtDate = (iso) => new Intl.DateTimeFormat(isEn ? 'en-GB' : 'ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const state = { i: 0, sort: 'value', filter: '' };

function render(data, countries) {
  const ind = data.indicators[state.i];
  const tabs = document.getElementById('cmp-tabs');
  tabs.replaceChildren();
  data.indicators.forEach((x, i) => {
    const b = el('button', 'cmp-tab', pick(x.name));
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === state.i));
    b.addEventListener('click', () => {
      state.i = i;
      render(data, countries);
    });
    tabs.append(b);
  });
  const note = document.getElementById('cmp-note');
  note.replaceChildren();
  // 情報の性質（統計／試算・推計）。地球儀の画面と同じ言葉を使う
  const nat = NATURE_LABELS[isEn ? 'en' : 'ja'][ind.nature];
  if (nat) {
    const b = el('span', 'badge nature nature-' + ind.nature, nat[0]);
    b.title = nat[1];
    note.append(b, ' ');
  }
  note.append(el('span', null, pick(ind.note) + ' '));
  const src = safeUrl(ind.source?.url);
  if (src) {
    const a = el('a', null, `${L.source}: ${ind.source.name}`);
    a.href = src;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    note.append(a);
  }
  const values = ind.values || {};
  const rows = countries.map((c) => ({ c, name: isEn ? c.enName || c.en?.[0] || c.id : c.ja || c.id, v: values[c.id] || null }));
  const withData = rows.filter((r) => r.v).length;
  const status = document.getElementById('cmp-status');
  status.textContent =
    ind.status === 'ok' ? `${L.withData(withData, rows.length)}${data.retrievedAt ? ' ' + L.retrieved(fmtDate(data.retrievedAt)) : ''}` : ind.status === 'notFetched' ? L.notFetched : L.failed;

  const q = state.filter.trim().toLowerCase();
  const shown = rows.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.c.en || []).some((n) => String(n).toLowerCase().includes(q)) || (r.c.ja || '').includes(state.filter.trim()));
  const byName = (a, b) => a.name.localeCompare(b.name, isEn ? 'en' : 'ja');
  shown.sort((a, b) => (state.sort === 'value' ? (a.v && b.v ? b.v[0] - a.v[0] : a.v ? -1 : b.v ? 1 : byName(a, b)) : byName(a, b)));
  const max = Math.max(0, ...rows.filter((r) => r.v).map((r) => r.v[0]));

  const box = document.getElementById('cmp-table');
  box.replaceChildren();
  const sortBtn = el('button', 'filter-btn', state.sort === 'value' ? L.sortN : L.sortV);
  sortBtn.type = 'button';
  sortBtn.addEventListener('click', () => {
    state.sort = state.sort === 'value' ? 'name' : 'value';
    render(data, countries);
  });
  box.append(sortBtn);
  const table = el('table', 'cmp-table');
  const head = el('tr');
  for (const h of [L.country, L.value, L.year]) head.append(el('th', null, h));
  table.append(el('thead'));
  table.tHead.append(head);
  const body = el('tbody');
  for (const r of shown) {
    const tr = el('tr', r.v ? null : 'cmp-nodata');
    tr.append(el('td', null, r.name));
    const td = el('td');
    if (r.v) {
      const bar = el('span', 'cmp-bar');
      bar.style.width = `${max > 0 ? Math.max(1, Math.round((r.v[0] / max) * 100)) : 0}%`;
      td.append(el('span', 'cmp-val', fmt(r.v[0], ind)), bar);
    } else td.append(el('span', 'cmp-val', L.noData));
    tr.append(td, el('td', null, r.v ? String(r.v[1]) : '—'));
    body.append(tr);
  }
  table.append(body);
  box.append(table);
}

(async () => {
  try {
    const [data, countries] = await Promise.all([
      fetch('data/compare.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('load')))),
      fetch('data/geo/country-index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('load')))),
    ]);
    if (!Array.isArray(data?.indicators) || !data.indicators.length || !Array.isArray(countries)) throw new Error('shape');
    const input = document.getElementById('cmp-filter');
    input.addEventListener('input', () => {
      state.filter = input.value;
      render(data, countries);
    });
    render(data, countries);
  } catch {
    document.getElementById('cmp-table').textContent = L.loadFail;
  }
})();
