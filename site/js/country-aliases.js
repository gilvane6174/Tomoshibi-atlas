// 国名の対訳（国連・WHOの正式表記など、地図データ Natural Earth の名前と綴りが違うもの）。
// 組み立て（scripts/lib/countries.mjs）とブラウザ（site/js/quake-live.js）で共通に使う。
export const ALIASES = {
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


// 国の一覧（site/data/geo/country-index.json の形）から、英語の国名 → ISO3 の対応を作る。
// 「A, B and C」のような列挙は分解し、1つでも不明なら null（部分一致で置かない）
export function makeCountryMatcher(index) {
  const byName = new Map();
  for (const c of index) for (const n of c.en || []) byName.set(String(n).toLowerCase(), c.id);
  for (const [k, v] of Object.entries(ALIASES)) byName.set(k, v);
  const one = (name) => {
    const key = name.trim().replace(/^the /i, '').toLowerCase();
    return byName.get(key) || byName.get('the ' + key) || null;
  };
  return (text) => {
    const ids = String(text).split(/,\s*|\s+and\s+|\s*;\s*/).map((s) => s.trim()).filter(Boolean).map(one);
    return ids.length && ids.every(Boolean) ? [...new Set(ids)] : null;
  };
}
