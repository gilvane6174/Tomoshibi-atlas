// 公表文中の英語国名を ISO3 コードへ機械的に対応づける。
// 一致しなければ「国不明」とし、推測で地球儀上に置かない。

import { readJson } from './safety.mjs';

const INDEX = readJson('site/data/geo/country-index.json');

// 国連・WHOの正式表記など、Natural Earth の名前と綴りが違うものの対訳
const ALIASES = {
  'united republic of tanzania': 'TZA',
  'türkiye': 'TUR',
  'turkiye': 'TUR',
  'viet nam': 'VNM',
  "lao people's democratic republic": 'LAO',
  'iran (islamic republic of)': 'IRN',
  'bolivia (plurinational state of)': 'BOL',
  'venezuela (bolivarian republic of)': 'VEN',
  'republic of korea': 'KOR',
  "democratic people's republic of korea": 'PRK',
  "côte d'ivoire": 'CIV',
  "cote d'ivoire": 'CIV',
  'syrian arab republic': 'SYR',
  'russian federation': 'RUS',
  'republic of moldova': 'MDA',
  'united kingdom of great britain and northern ireland': 'GBR',
  'united kingdom': 'GBR',
  'united states': 'USA',
  'united states of america': 'USA',
  'the united states of america': 'USA',
  'kingdom of saudi arabia': 'SAU',
  'occupied palestinian territory': 'PSE',
  'occupied palestinian territory, including east jerusalem': 'PSE',
  'democratic republic of the congo': 'COD',
  'the democratic republic of the congo': 'COD',
  'republic of the congo': 'COG',
  'congo': 'COG',
  'cabo verde': 'CPV',
  'eswatini': 'SWZ',
  'czechia': 'CZE',
  'netherlands (kingdom of the)': 'NLD',
  'micronesia (federated states of)': 'FSM',
};

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
