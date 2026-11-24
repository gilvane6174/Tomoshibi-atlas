// 「急な病気・けがのとき」のページの検索：症状名・病名を、ひらがな・カタカナ・漢字のどれで入れても探せるようにする。
// データは同じサイトの data/health-guide.json だけ（外部への通信はしない）。文字はすべて textContent で入れる。
// 結果のリンクは、検査（scripts/validate-data.mjs）を通った公的機関の公式ページだけ。

import { setupKanaSwitch } from './kana-switch.js';
import { revealResults } from './reveal.js';

// 全角・半角をそろえ、カタカナをひらがなにし、空白や区切りを除く
export function normalizeHealth(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・･、,（）()「」]/g, '');
}

// 1件の検索用の文字（名前・読み・別名）
export function keysOf(item) {
  return [item.name, item.kana, ...(item.aliases || [])].map(normalizeHealth).filter(Boolean);
}

// 一致の強さ：完全一致 3・前方一致 2・部分一致 1・なし 0
export function scoreHealth(item, query) {
  const q = normalizeHealth(query);
  if (!q) return 0;
  let best = 0;
  for (const k of keysOf(item)) {
    if (k === q) return 3;
    if (k.startsWith(q)) best = Math.max(best, 2);
    else if (k.includes(q)) best = Math.max(best, 1);
  }
  return best;
}

// audience: 'all' | 'general' | 'care'
export function searchHealth(items, query, audience = 'all') {
  const pool = items.filter((it) => audience === 'all' || it.audience.includes(audience));
  if (!normalizeHealth(query)) return pool;
  return pool
    .map((it, i) => ({ it, i, s: scoreHealth(it, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || Number(b.it.urgent) - Number(a.it.urgent) || a.i - b.i)
    .map((x) => x.it);
}

const KIND_LABEL = { symptom: ['症状', 'しょうじょう'], disease: ['病気', 'びょうき'], firstaid: ['応急手当', 'おうきゅう てあて'], search: ['探す', 'さがす'] };

// 「ひらがなで よむ」用：漢字の文と、ひらがなの文を並べて入れる（表示の切り替えは CSS）。文字は textContent だけで入れる
function pair(el, std, alt) {
  const a = document.createElement('span');
  a.className = 'kana-std';
  a.textContent = std;
  const b = document.createElement('span');
  b.className = 'kana-alt';
  b.textContent = alt || std;
  el.replaceChildren(a, b);
  return el;
}

// 運用者の確認の期限（scripts/lib/health-checks.mjs の HUMAN_CHECK_DAYS と同じ）
const CHECK_DAYS = 45;

function card(item) {
  const li = document.createElement('li');
  li.className = 'hs-item' + (item.urgent ? ' hs-urgent' : '');
  const h = document.createElement('h3');
  pair(h, item.name, item.kana);
  const meta = document.createElement('p');
  meta.className = 'item-meta';
  const tags = [KIND_LABEL[item.kind] || ['', '']];
  if (item.audience.includes('care')) tags.push(['介護の現場でも', 'かいごの げんばでも']);
  if (item.urgent) tags.push(['急ぐことが多い', 'いそぐ ことが おおい']);
  const used = tags.filter((x) => x[0]);
  pair(meta, used.map((x) => x[0]).join('・'), used.map((x) => x[1]).join('・'));
  // 症状ごとの対応の説明文は載せない（公式ページへの案内だけ。2026-11-24 運用者の判断）
  const ul = document.createElement('ul');
  if (!item.links.length) {
    const li = document.createElement('li');
    pair(li, '公式ページへのリンクは確認待ちです（毎月、人が中身を確かめてから表示します）。', 'こうしき ページへの リンクは かくにん まち です（まいつき、ひとが なかみを たしかめてから ひょうじ します）。');
    ul.append(li);
  }
  for (const l of item.links) {
    const a = document.createElement('a');
    a.href = l.url;
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    a.textContent = l.name;
    const lli = document.createElement('li');
    lli.append(a);
    // 運用者（人）が最後に中身を確かめた日。45日を過ぎていたら、その旨も出す（リンク先でご確認を）
    if (/^\d{4}-\d{2}-\d{2}$/.test(l.checked || '')) {
      const old = Date.now() - Date.parse(`${l.checked}T00:00:00+09:00`) > CHECK_DAYS * 86400000;
      const d = l.checked.replace(/-/g, '/');
      const note = document.createElement('span');
      note.className = 'hs-checked' + (old ? ' is-old' : '');
      pair(note, old ? `（確認日 ${d}。確認の時期を過ぎています。リンク先の内容をご確認ください）` : `（確認日 ${d}）`, old ? `（かくにんび ${d}。かくにんの じきを すぎて います。リンクさきの ないようを ごかくにん ください）` : `（かくにんび ${d}）`);
      lli.append(' ', note);
    }
    ul.append(lli);
  }
  li.append(h, meta, ul);
  return li;
}

async function setup() {
  const input = document.getElementById('hs-input');
  const list = document.getElementById('hs-results');
  const count = document.getElementById('hs-count');
  const aud = document.getElementById('hs-audience');
  if (!input || !list) return;
  let items = [];
  try {
    const r = await fetch('data/health-guide.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('load');
    items = (await r.json()).items;
  } catch {
    pair(list, '検索のデータを読み込めませんでした。下の各項目から公式の情報をご覧ください。', 'けんさくの データを よみこめません でした。したの かく こうもくから こうしきの じょうほうを ごらん ください。');
    return;
  }
  const render = () => {
    const found = searchHealth(items, input.value, aud ? aud.value : 'all');
    list.replaceChildren(...found.map(card));
    if (count)
      input.value.trim()
        ? pair(count, `${found.length}件見つかりました`, `${found.length}けん みつかりました`)
        : pair(count, `全${found.length}件（例：「てんかん」「ねっちゅうしょう」「窒息」「ろれつ」などと入力すると絞り込みます）`, `ぜんぶで ${found.length}けん（れい：「てんかん」「ねっちゅうしょう」「ちっそく」「ろれつ」など と にゅうりょく すると しぼりこみます）`);
    if (!found.length) {
      const li = document.createElement('li');
      li.className = 'hs-item';
      pair(li, '見つかりませんでした。別の言い方（ひらがな・漢字）で試してください。緊急のときは119番。救急車を呼ぶか迷うときは、実施地域なら＃7119へ。受診できる医療機関を探すときは、医療情報ネット（ナビイ）を使えます。', 'みつかりません でした。べつの いいかた（ひらがな・かんじ）で ためして ください。きんきゅうの ときは 119ばん。きゅうきゅうしゃを よぶか まよう ときは、じっし ちいき なら ＃7119へ。じゅしん できる いりょう きかんを さがす ときは、いりょう じょうほう ネット（ナビイ）を つかえます。');
      list.append(li);
    }
  };
  input.addEventListener('input', render);
  if (aud) aud.addEventListener('change', render);
  for (const b of document.querySelectorAll('[data-hs-word]')) {
    // 0件になる言葉は出さない（データを直したときに、空振りのボタンが残らないように）
    if (!searchHealth(items, b.getAttribute('data-hs-word')).length) continue;
    b.hidden = false;
    b.addEventListener('click', () => {
      input.value = b.getAttribute('data-hs-word');
      render();
      // 結果の一覧が画面の外にあるときは、そこまで動かす（入力欄には戻らない。スマホでキーボードが開かないように）
      revealResults(count || list, { focus: false });
    });
  }
  render();
}

if (typeof document !== 'undefined') {
  setupKanaSwitch();
  setup();
}
