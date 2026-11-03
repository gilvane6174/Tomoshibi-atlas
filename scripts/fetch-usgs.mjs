// 地震：米国地質調査所（USGS）が公開する、世界の大きな地震（マグニチュード5.5以上）の一覧を取得する。
// 取得先は USGS の公式のリアルタイム配信（GeoJSON、過去30日・M4.5以上）。USGS の資料は米国政府の著作物で、
// 出典（U.S. Geological Survey）を示せば自由に使える。リダイレクトは追わず、大きさの上限を設ける（lib/http.mjs）。
// 速報値は後から修正されることがある。このサイトは緊急時の情報源ではない（画面と説明ページに明記）。
import { fetchJson } from './lib/http.mjs';
import { readJson, cleanText, stripTags, isAllowedUrl } from './lib/safety.mjs';
import { matchCountryList } from './lib/countries.mjs';
import { RULES } from './importance-rules.mjs';
import { MIN_MAG as CORE_MIN_MAG, normalizeQuakeWith, placeToCountries as corePlaceToCountries } from '../site/js/quake-core.js';

const { fetchEndpoints } = readJson('scripts/allowed-sources.json');
// 1件ごとの変換の決まりは site/js/quake-core.js に置き、ブラウザでの直接取得（site/js/quake-live.js）と共通にする
export const MIN_MAG = CORE_MIN_MAG;
export const placeToCountries = (place) => corePlaceToCountries(place, matchCountryList);

// 対象外（地震以外・M5.5未満・30日より前）は null を返す（正常な除外）。
// 形の異常（項目・id・規模・時刻の不正）は例外を投げ、inspectQuakes が「異常」として数える。
export function normalizeQuake(f, now = Date.now()) {
  return normalizeQuakeWith(f, now, {
    keepDays: RULES.quake.keepDays,
    majorWithinDays: RULES.quake.majorWithinDays,
    matchCountryList,
    clean: (s, n) => cleanText(stripTags(s), n),
    eventUrl: (id) => {
      const url = `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`;
      return isAllowedUrl(url) ? url : null;
    },
  });
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
