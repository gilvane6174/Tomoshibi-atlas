// 地震（米国地質調査所 USGS）の1件を、このサイトの表示用の形に直す共通の処理。
// 組み立て（scripts/fetch-usgs.mjs、Node）と、ブラウザでの直接取得（site/js/quake-live.js）の両方が同じ決まりで使う。
// 外部への通信も画面への書き込みもしない純粋な関数（scripts/test.mjs で検査する）。

export const MIN_MAG = 5.5;
export const EVENT_ID = /^[a-z0-9]{4,24}$/;
// 米国の州・地域名などで終わる場所の表記（例：「… , Alaska」）を国に対応づける
const PLACE_ALIASES = { alaska: 'USA', ak: 'USA', hawaii: 'USA', hi: 'USA', california: 'USA', ca: 'USA', nevada: 'USA', nv: 'USA', oregon: 'USA', washington: 'USA', idaho: 'USA', montana: 'USA', utah: 'USA', wyoming: 'USA', texas: 'USA', oklahoma: 'USA', 'new mexico': 'USA' };
// 「Georgia」は国（ジョージア）と米国の州の区別がつかないため、地球儀には置かない
const AMBIGUOUS = new Set(['georgia']);
// 国境・帰属について日本の一般的な地図と表し方が異なりうる地域（北方領土・千島列島など）は、地球儀には置かず一覧にだけ出す
const DISPUTED = /kuril|shikotan|etorofu|iturup|kunashir|habomai|yuzhno-kurilsk|crimea|sevastopol/i;

const DAY = 86400000;
const within = (iso, days, now) => (now - new Date(iso).getTime()) / DAY <= days;

// 「37 km SW of Hualien City, Taiwan」の最後の区切り（Taiwan）から国を決める。分からなければ地球儀には置かない
export function placeToCountries(place, matchCountryList) {
  if (DISPUTED.test(place)) return [];
  const last = place.split(',').pop().trim();
  if (AMBIGUOUS.has(last.toLowerCase())) return [];
  const alias = PLACE_ALIASES[last.toLowerCase()];
  if (alias) return [alias];
  return matchCountryList(last.replace(/ region$/i, '')) || [];
}

const malformed = (why) => {
  throw new Error('USGS item malformed: ' + why);
};

// 対象外（地震以外・M5.5未満・掲載期間より前）は null を返す（正常な除外）。形の異常は例外を投げる。
// opts：keepDays・majorWithinDays（掲載期間と大きく表示する期間）、matchCountryList（国名→ISO3 の配列）、
//       clean（文字の清掃）、eventUrl（id と properties から、確認済みの USGS の地震のページの URL を返す。無効なら null）
export function normalizeQuakeWith(f, now, { keepDays, majorWithinDays, matchCountryList, clean, eventUrl }) {
  const p = f?.properties;
  if (!p || typeof p !== 'object') malformed('no properties');
  if (p.type !== 'earthquake') return null;
  const mag = typeof p.mag === 'number' ? p.mag : NaN;
  if (!Number.isFinite(mag) || mag < 0 || mag > 10) malformed('magnitude');
  if (mag < MIN_MAG) return null;
  const id = typeof f.id === 'string' ? f.id.toLowerCase() : '';
  if (!EVENT_ID.test(id)) malformed('id');
  // 発生時刻：数値で、日付として表せる範囲（2000年〜現在＋1時間）に限る
  const t = typeof p.time === 'number' ? p.time : NaN;
  if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > now + 3600000 || !Number.isFinite(new Date(t).getTime())) malformed('time');
  const publishedAt = new Date(t).toISOString();
  if (!within(publishedAt, keepDays, now)) return null;
  const place = clean(String(p.place || ''), 120);
  const url = eventUrl(id, p);
  if (!url) malformed('url');
  const m = mag.toFixed(1);
  const countries = place ? placeToCountries(place, matchCountryList) : [];
  const original = `M ${m} - ${place || 'location not given'}`;
  return {
    id: 'usgs-' + id,
    layer: 'quake',
    // 場所の表記は USGS の英語表記のまま（本サイトが国名を付け替えない）
    title: { ja: `地震（マグニチュード${m}）${place ? '｜USGSの表記：' + place : ''}`, en: `M ${m} earthquake${place ? ' – ' + place : ''}`, original },
    tags: ['disaster'],
    topic: 'usgs-' + id,
    countries,
    placeBasis: countries.length ? 'reported_country' : 'unknown',
    // 文字の大小は新しさだけで決める（被害の大きさの評価ではない）
    importance: within(publishedAt, majorWithinDays, now) ? 'major' : 'minor',
    publishedAt,
    source: { name: 'U.S. Geological Survey (USGS) Earthquake Hazards Program', url },
  };
}

// 新しい一覧（直接取得）と、組み立て時の一覧を、同じ地震（id）は新しい方を優先して一つにまとめる。
// 掲載期間を過ぎたものは外し、新しい順に max 件まで。
export function mergeQuakes(fresh, previous, now, { keepDays, max }) {
  const byId = new Map();
  for (const it of previous || []) byId.set(it.id, it);
  for (const it of fresh || []) byId.set(it.id, it);
  return [...byId.values()]
    .filter((it) => within(it.publishedAt, keepDays, now))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))
    .slice(0, max);
}
