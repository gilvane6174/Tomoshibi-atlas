// 詳細パネル・一覧パネル・使い方パネル。要素はすべて createElement と textContent で組み立てる。

import { t, pickText, setRich, lang } from './i18n.js';
import { groupIcon } from './icons.js';
import { LAYERS, layerById, safeHttpsUrl, formatDate, countryName, ageDays, ageLabel } from './data.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function link(url, text) {
  const href = safeHttpsUrl(url);
  if (!href) return null;
  const a = el('a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.referrerPolicy = 'no-referrer';
  return a;
}

const badge = (cls, text) => el('span', 'badge ' + cls, text);

export function entry(item, { countryMap, asButton = false, onClick } = {}) {
  const layer = layerById(item.layer);
  const box = el('article', 'entry ' + layer.group + (item.superseded ? ' is-superseded' : ''));
  box.style.setProperty('--dot', layer.color);

  // 灯（支える情報）か警鐘（注意が必要な情報）かを、小さな印と文字で示す
  const kind = el('p', 'entry-kind ' + layer.group);
  kind.append(groupIcon(layer.group), el('span', null, t('badge.group.' + layer.group)));
  box.append(kind);

  const title = pickText(item.title);
  const head = el(asButton ? 'button' : 'h3', 'entry-title ' + item.importance, title.text);
  if (asButton) {
    head.type = 'button';
    head.addEventListener('click', onClick);
  }
  if (title.shownIn !== lang) head.lang = title.shownIn;
  box.append(head);

  // 状態の表示：以前の情報／古い公表／言語
  const flags = el('p', 'entry-flags');
  if (item.superseded) flags.append(badge('superseded', t('badge.superseded')));
  else if (ageDays(item.publishedAt) > 30) flags.append(badge('stale', t('badge.stale')));
  if (title.shownIn === 'ja' && lang === 'en') flags.append(badge('lang', t('badge.jaOnly')));
  if (title.shownIn === 'en' && lang === 'ja') flags.append(badge('lang', t('badge.enOnly')));
  if (flags.childElementCount) box.append(flags);

  if (item.title.original && item.title.original !== title.text) {
    const o = el('p', 'entry-original', item.title.original);
    o.lang = 'en';
    box.append(o);
  }

  if (item.summary) {
    const s = el('p', 'entry-summary');
    if (item.attribution) s.append(el('span', 'entry-attr', pickText(item.attribution).text + (lang === 'en' ? ', ' : '、')));
    s.append(document.createTextNode(pickText(item.summary).text));
    box.append(s);
  }

  const meta = el('p', 'entry-meta');
  const age = lang === 'en' ? ` (${ageLabel(item.publishedAt)})` : `（${ageLabel(item.publishedAt)}）`;
  meta.append(el('span', null, t('meta.published', { date: formatDate(item.publishedAt) }) + age));
  if (item.checkedAt) meta.append(el('span', null, t('meta.checked', { date: formatDate(item.checkedAt) })));
  const places = (item.countries || []).map((id) => countryName(countryMap?.get(id))).filter(Boolean);
  const basis = t('basis.' + item.placeBasis);
  meta.append(el('span', null, places.length ? `${places.join(lang === 'en' ? ', ' : '・')} — ${basis}` : basis));
  for (const tag of item.tags || []) meta.append(el('span', 'tag', t('tag.' + tag)));
  box.append(meta);

  const links = el('p', 'entry-links');
  const main = link(item.source.url, `${t('link.source')}: ${item.source.name}`);
  if (main) links.append(main);
  for (const l of item.links || []) {
    const a = link(l.url, l.label);
    if (a) links.append(a);
  }
  box.append(links);
  return box;
}

const note = (kind) => el('p', 'note', t(kind === 'auto' ? 'note.auto' : 'note.curated'));

function mentalSupport() {
  const wrap = el('div', 'note support');
  wrap.append(el('p', null, t('note.mental')));
  const a = link('https://www.mhlw.go.jp/mamorouyokokoro/', t('support.mental'));
  if (a) wrap.append(a);
  return wrap;
}

// 新しい情報を先、以前の情報（superseded）を後に並べる
const ordered = (items) => [...items.filter((x) => !x.superseded), ...items.filter((x) => x.superseded)];

// ── 国・分野別の公式リンク集（福祉の相談先・こころの相談先・専門機関など）──
// kana=true のとき、日本語表示の文をすべて「ひらがな（＋カタカナ）」で表示する
const DIR_TITLE = { welfare: 'dir.title.welfare', mental: 'dir.title.mental', security: 'dir.title.security', research: 'dir.title.research', outbreak: 'dir.title.outbreak' };

// ひらがな表示用の日付（例：2026ねん 10がつ 25にち）
const kanaDate = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${y}ねん ${m}がつ ${d}にち`;
};

function dirText(obj, kana) {
  if (lang === 'en') return obj.en;
  return kana ? obj.jaKana : obj.ja;
}

// 説明文：個別の説明があればそれを、なければ役割（保健省・福祉省など）ごとの共通の説明を使う
function dirDesc(l, kana) {
  if (l.desc) return dirText(l.desc, kana);
  const key = 'dir.role.' + l.role;
  return t(lang === 'ja' && kana ? key + '.kana' : key);
}

// リンク先ページの言語（日本語以外のとき、利用者が開く前に分かるように表示）
function pageLangNote(l, kana) {
  const codes = (l.pageLang || []).filter((c) => c !== lang);
  if (!codes.length || (l.pageLang || []).includes(lang)) return null;
  const sfx = lang === 'ja' && kana ? '.kana' : '';
  const names = codes.map((c) => (t('lang.' + c + sfx) !== 'lang.' + c + sfx ? t('lang.' + c + sfx) : c.toUpperCase()));
  return t('dir.pageLang' + sfx, { langs: names.join(lang === 'en' ? ', ' : '・') });
}

function dirLink(l, kana) {
  const href = safeHttpsUrl(l.url);
  if (!href) return null;
  const li = el('li', 'dir-item');
  const a = link(href, dirText(l.name, kana));
  a.className = 'dir-name';
  const host = el('span', 'dir-host', new URL(href).hostname);
  host.lang = 'en';
  li.append(a, el('p', 'dir-desc', dirDesc(l, kana)));
  const note = pageLangNote(l, kana);
  if (note) li.append(el('span', 'dir-lang', note));
  li.append(host);
  if (l.checkedAt) li.append(el('span', 'dir-checked', t(kana && lang === 'ja' ? 'dir.checked.kana' : 'dir.checked', { date: kana && lang === 'ja' ? kanaDate(l.checkedAt) : formatDate(l.checkedAt) })));
  return li;
}

function dirList(links, kana) {
  const ul = el('ul', 'dir-list');
  for (const l of links) {
    const li = dirLink(l, kana);
    if (li) ul.append(li);
  }
  return ul;
}

export function directorySection(country, layerId, dir, { kana = false, onToggleKana } = {}) {
  const k = lang === 'ja' && kana;
  const tk = (key, vars) => t(k ? key + '.kana' : key, vars);
  const wrap = el('section', 'directory' + (k ? ' is-kana' : ''));
  wrap.style.setProperty('--dot', layerById(layerId).color);
  const head = el('div', 'dir-head');
  head.append(el('h3', null, tk(DIR_TITLE[layerId])));
  if (lang === 'ja' && onToggleKana) {
    const b = el('button', 'kana-toggle', k ? t('dir.kanaOff') : t('dir.kanaOn'));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(k));
    b.addEventListener('click', onToggleKana);
    head.append(b);
  }
  wrap.append(head);

  if (!dir) {
    wrap.append(el('p', 'empty', t('dir.unavailable')));
    return wrap;
  }
  const own = dir.countries?.[country.id]?.[layerId] || [];
  const intl = dir.international?.[layerId] || [];

  if (own.length && layerId === 'welfare') {
    wrap.append(el('p', 'dir-lead', tk('dir.lead.welfare')), el('h4', 'dir-sub', tk('dir.forPeople')));
    for (const c of dir.categories) {
      const links = own.filter((l) => l.cat === c.id);
      if (!links.length) continue;
      const g = el('div', 'dir-group');
      g.append(el('h5', 'dir-cat', dirText(c, k)), dirList(links, k));
      wrap.append(g);
    }
  } else if (own.length) {
    wrap.append(dirList(own, k));
  } else {
    wrap.append(el('p', 'empty', tk(intl.length ? 'dir.none' : 'dir.noneNoIntl')));
  }

  if (intl.length) {
    wrap.append(el('h4', 'dir-intl', tk('dir.international')), dirList(intl, k));
  }
  wrap.append(el('p', 'note', tk('dir.note')));
  if (k) wrap.append(el('p', 'note', t('dir.kanaNote')));
  return wrap;
}

// ── X（旧Twitter）：投稿は取得・表示せず、公的機関の公式アカウントへのリンクだけを出す ──
// 一般の検索へのリンクは出さない（未確認の投稿や危険なサイトへ誘導しうるため。ops/LINK-SAFETY.md）
export function snsSection(country, layerId, dir, { kana = false } = {}) {
  const k = lang === 'ja' && kana;
  const tk = (key, vars) => t(k ? key + '.kana' : key, vars);
  const wrap = el('section', 'sns' + (k ? ' is-kana' : ''));
  wrap.append(el('h3', null, tk('sns.title')));
  wrap.append(el('p', 'note', tk('sns.note')));
  wrap.append(el('p', 'note', tk('sns.checked', { date: k ? kanaDate(dir?.reviewedAt) : formatDate(dir?.reviewedAt) })));
  const accounts = [...(dir?.social?.[country.id] || []), ...(dir?.social?.INTL || [])].filter((a) => a.layers.includes(layerId));
  if (!accounts.length) return null;
  {
    wrap.append(el('h4', 'dir-sub', tk('sns.official')));
    const ul = el('ul', 'dir-list');
    for (const a of accounts) {
      const li = el('li', 'dir-item');
      const ln = link(a.url, dirText(a.org, k));
      if (!ln) continue;
      ln.className = 'dir-name';
      li.append(ln, el('span', 'dir-host', 'x.com'));
      ul.append(li);
    }
    wrap.append(ul);
  }
  wrap.append(el('p', 'note', tk('sns.searchNote')));
  return wrap;
}

export function renderCountry(body, { country, layerId, data, onSwitchLayer, kana = false, onToggleKana }) {
  body.replaceChildren();
  const doc = data.layers[layerId];
  const items = ordered(doc.items.filter((it) => (it.countries || []).includes(country.id)));
  const h = el('h3', 'layer-head ' + layerById(layerId).group, t('panel.inLayer', { layer: t('layer.' + layerId) }));
  h.prepend(groupIcon(layerById(layerId).group));
  h.style.setProperty('--dot', layerById(layerId).color);
  body.append(h);
  if (doc.status === 'preparing') body.append(el('p', 'empty', t('status.preparingLong')));
  else if (doc.status === 'notFetched') body.append(el('p', 'empty', t('status.notFetchedLong')));
  else if (!items.length) body.append(el('p', 'empty', t('panel.none')));
  for (const it of items) body.append(entry(it, { countryMap: data.countryMap }));
  if (items.length) body.append(note(doc.kind));
  if (layerId === 'security') body.append(el('p', 'note caution-note', t('note.security')));
  // ほかの分野へ、この地域のまま切り替えるボタン
  const others = LAYERS.filter((l) => l.id !== layerId)
    .map((l) => [l, data.layers[l.id].items.filter((it) => !it.superseded && (it.countries || []).includes(country.id)).length])
    .filter(([, n]) => n > 0);
  if (others.length) {
    body.append(el('h3', null, t('panel.otherLayers')));
    const row = el('div', 'switch-row');
    for (const [l, n] of others) {
      const b = el('button', 'link-chip', `${t('layer.' + l.id)} ${n}${lang === 'en' ? '' : '件'}`);
      b.type = 'button';
      b.style.setProperty('--dot', l.color);
      b.addEventListener('click', () => onSwitchLayer(l.id));
      row.append(b);
    }
    body.append(row, el('p', 'hint', t('panel.otherHint')));
  }

  // こころの分野では、詳細の中にも、つらいとき・緊急時の連絡先の案内を出す
  if (layerId === 'mental') body.append(el('p', 'note crisis-note', t('note.crisis')));
  // 下部：この国の公式リンク集（分野ごと）
  body.append(directorySection(country, layerId, data.directory, { kana, onToggleKana }));
  const sns = snsSection(country, layerId, data.directory, { kana });
  if (sns) body.append(sns);
}

export function renderList(body, { layerId, data, onPick }) {
  body.replaceChildren();
  const doc = data.layers[layerId];
  if (doc.status === 'preparing' || doc.status === 'notFetched') {
    body.append(el('p', 'empty', t(doc.status === 'preparing' ? 'status.preparingLong' : 'status.notFetchedLong')));
    if (layerId === 'mental') body.append(mentalSupport());
    return;
  }
  const placed = ordered(doc.items.filter((it) => it.countries?.length));
  const unplaced = ordered(doc.items.filter((it) => !it.countries?.length));
  for (const it of placed) body.append(entry(it, { countryMap: data.countryMap, asButton: true, onClick: () => onPick(it.countries[0]) }));
  if (unplaced.length) {
    body.append(el('h3', null, t('panel.unplaced')));
    for (const it of unplaced) body.append(entry(it, { countryMap: data.countryMap }));
  }
  body.append(note(doc.kind));
  if (layerId === 'security') body.append(el('p', 'note caution-note', t('note.security')));
  if (layerId === 'mental') body.append(mentalSupport());
}

export function renderGuide(body, { aboutHref, onFindWelfare }) {
  body.replaceChildren();
  body.append(el('p', 'guide-lead', t('purpose.body')), el('p', null, t('purpose.relation')));

  body.append(el('h3', null, t('guide.tabs')));
  const tabs = el('ul', 'guide-list');
  for (const l of LAYERS) {
    const li = el('li');
    li.style.setProperty('--dot', l.color);
    setRich(li, 'caption.' + l.id);
    tabs.append(li);
  }
  body.append(tabs);

  body.append(el('h3', null, t('guide.howto')));
  const how = el('ul', 'guide-list plain');
  for (const k of ['guide.howto.1', 'guide.howto.2', 'guide.howto.3']) how.append(el('li', null, t(k)));
  body.append(how);

  body.append(el('h3', null, t('guide.legend')));
  const leg = el('ul', 'guide-list plain');
  for (const k of ['guide.legend.1', 'guide.legend.2', 'guide.legend.3']) leg.append(el('li', null, t(k)));
  body.append(leg);

  // 追記：福祉の相談窓口・個人でできるセキュリティ対策・研究とのつながり
  const add = el('section', 'addendum');
  add.append(el('h3', null, t('add.title')));
  const w = el('p', null, t('add.welfare'));
  add.append(w);
  if (onFindWelfare) {
    const b = el('button', 'text-btn', t('add.welfareBtn'));
    b.type = 'button';
    b.addEventListener('click', onFindWelfare);
    add.append(el('p', null).appendChild(b).parentNode);
  }
  add.append(el('p', null, t('add.security')));
  const sec = el('a', 'text-link', t('add.securityBtn'));
  sec.href = lang === 'en' ? 'security-basics.en.html' : 'security-basics.html';
  add.append(el('p', null).appendChild(sec).parentNode);
  add.append(el('p', null, t('add.research')), el('p', 'note', t('add.sources')));
  body.append(add);

  body.append(el('p', 'note', t('locate.privacy')));
  body.append(el('p', 'note', t('notice.impersonation')));
  const more = el('a', 'text-link', t('guide.more'));
  more.href = aboutHref;
  body.append(el('p', null).appendChild(more).parentNode);
}
