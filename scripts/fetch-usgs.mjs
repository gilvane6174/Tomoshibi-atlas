// 地震：米国地質調査所（USGS）が公開する、世界の大きな地震（マグニチュード5.5以上）の一覧を取得する。
// 取得先は USGS の公式のリアルタイム配信（GeoJSON、過去30日・M4.5以上）。USGS の資料は米国政府の著作物で、
// 出典（U.S. Geological Survey）を示せば自由に使える。リダイレクトは追わず、大きさの上限を設ける（lib/http.mjs）。
// 速報値は後から修正されることがある。このサイトは緊急時の情報源ではない（画面と説明ページに明記）。
import { fetchJson } from './lib/http.mjs';
import { readJson, cleanText, stripTags, isAllowedUrl, toIsoDate } from './lib/safety.mjs';
import { matchCountryList } from './lib/countries.mjs';
import { RULES, withinDays } from './importance-rules.mjs';

const { fetchEndpoints } = readJson('scripts/allowed-sources.json');
export const MIN_MAG = 5.5;
const EVENT_ID = /^[a-z0-9]{4,24}$/;
// 米国の州・地域名などで終わる場所の表記（例：「… , Alaska」）を国に対応づける
const PLACE_ALIASES = { alaska: 'USA', ak: 'USA', hawaii: 'USA', hi: 'USA', california: 'USA', ca: 'USA', nevada: 'USA', nv: 'USA', oregon: 'USA', washington: 'USA', idaho: 'USA', montana: 'USA', utah: 'USA', wyoming: 'USA', texas: 'USA', oklahoma: 'USA', 'new mexico': 'USA' };
// 「Georgia」は国（ジョージア）と米国の州の区別がつかないため、地球儀には置かない
const AMBIGUOUS = new Set(['georgia']);
// 国境・帰属について日本の一般的な地図と表し方が異なりうる地域（北方領土・千島列島など）は、地球儀には置かず一覧にだけ出す
// （USGS は「… of Kuril'sk, Russia」のように書くため、そのまま国に対応づけると、このサイトの地図の方針と食い違う）
const DISPUTED = /kuril|shikotan|etorofu|iturup|kunashir|habomai|yuzhno-kurilsk|crimea|sevastopol/i;

// 「37 km SW of Hualien City, Taiwan」の最後の区切り（Taiwan）から国を決める。分からなければ地球儀には置かない
export function placeToCountries(place) {
  if (DISPUTED.test(place)) return [];
  const last = place.split(',').pop().trim();
  if (AMBIGUOUS.has(last.toLowerCase())) return [];
  const alias = PLACE_ALIASES[last.toLowerCase()];
  if (alias) return [alias];
  return matchCountryList(last.replace(/ region$/i, '')) || [];
}

// 対象外（地震以外・M5.5未満・30日より前）は null を返す（正常な除外）。
// 形の異常（項目・id・規模・時刻の不正）は例外を投げ、inspectQuakes が「異常」として数える。
const malformed = (why) => {
  throw new Error('USGS item malformed: ' + why);
};
export function normalizeQuake(f, now = Date.now()) {
  const p = f?.properties;
  if (!p || typeof p !== 'object') malformed('no properties');
  if (p.type !== 'earthquake') return null;
  const mag = typeof p.mag === 'number' ? p.mag : NaN;
  if (!Number.isFinite(mag) || mag < 0 || mag > 10) malformed('magnitude');
  if (mag < MIN_MAG) return null;
  const id = typeof f.id === 'string' ? f.id.toLowerCase() : '';
  if (!EVENT_ID.test(id)) malformed('id');
  // 発生時刻：数値で、日付として表せる範囲（2000年〜現在＋1時間）に限る。範囲外（例：1e20）は日付変換で例外になるため先に調べる
  const t = typeof p.time === 'number' ? p.time : NaN;
  if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > now + 3600000 || !Number.isFinite(new Date(t).getTime())) malformed('time');
  const publishedAt = toIsoDate(t);
  if (!withinDays(publishedAt, RULES.quake.keepDays, now)) return null;
  const place = cleanText(stripTags(String(p.place || '')), 120);
  const url = `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`;
  if (!isAllowedUrl(url)) malformed('url');
  const m = mag.toFixed(1);
  const countries = place ? placeToCountries(place) : [];
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
    importance: withinDays(publishedAt, RULES.quake.majorWithinDays, now) ? 'major' : 'minor',
    publishedAt,
    source: { name: 'U.S. Geological Survey (USGS) Earthquake Hazards Program', url },
  };
}

// 応答全体の形を確かめ、項目ごとに変換する。1項目の異常（例外を含む）は、その項目だけ除く。
// 戻り値：items（変換できた項目）、raw（応答の項目数）、rejected（除いた数。対象外の小さな地震などの正常な除外も含む）
export function inspectQuakes(doc, now = Date.now()) {
  if (!doc || doc.type !== 'FeatureCollection' || !Array.isArray(doc.features)) throw new Error('USGS: unexpected response shape');
  const items = [];
  let errors = 0;
  for (const f of doc.features) {
    try {
      const it = normalizeQuake(f, now);
      if (it) items.push(it);
    } catch {
      errors++;
    }
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { items, raw: doc.features.length, errors };
}

// 取得結果の状態（build.mjs の説明を参照）。最後の検査（valid）が終わってから決める
export function quakeStatusOf({ raw, normalized, errors, valid }) {
  if (valid > 0) return 'ok';
  if (raw === 0 || (normalized === 0 && errors === 0)) return 'empty'; // 地震が無い・対象外の小さな地震だけ＝正常な0件
  return 'invalid';
}

export const processQuakes = (doc, now = Date.now()) => inspectQuakes(doc, now).items;

export async function fetchQuakes() {
  return inspectQuakes(await fetchJson(fetchEndpoints.usgsQuakes));
}
