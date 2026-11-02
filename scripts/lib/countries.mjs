// 公表文中の英語国名を ISO3 コードへ機械的に対応づける。
// 一致しなければ「国不明」とし、推測で地球儀上に置かない。

import { readJson } from './safety.mjs';
import { ALIASES } from '../../site/js/country-aliases.js';

const INDEX = readJson('site/data/geo/country-index.json');

// 国連・WHOの正式表記など、Natural Earth の名前と綴りが違うものの対訳は site/js/country-aliases.js（ブラウザと共通）
const BY_NAME = new Map();
for (const c of INDEX) for (const n of c.en) BY_NAME.set(n.toLowerCase(), c.id);
for (const [k, v] of Object.entries(ALIASES)) BY_NAME.set(k, v);

export const GLOBAL_WORDS = /^(global|global situation|multi-country|multi-country outbreak|worldwide|multiple countries)/i;

export function matchCountry(name) {
  const key = name.trim().replace(/^the /i, '').toLowerCase();
  return BY_NAME.get(key) || BY_NAME.get('the ' + key) || null;
}

export const countryById = (id) => INDEX.find((c) => c.id === id) || null;

// 「A, B and C」のような列挙を分解して ISO3 の配列にする。1つでも不明なら null（部分一致で置かない）
export function matchCountryList(text) {
  const parts = text.split(/,\s*|\s+and\s+|\s*;\s*/).map((s) => s.trim()).filter(Boolean);
  const ids = parts.map(matchCountry);
  return ids.every(Boolean) ? [...new Set(ids)] : null;
}
