// 「世界をくらべる」ページの指標：世界銀行（World Bank）の公開 API から、国ごとの最新の値（空でない最新年）を取得する。
// 取得先は scripts/allowed-sources.json の fetchEndpoints（wb で始まるキー）だけ。リダイレクトは追わず、大きさの上限を設ける（lib/http.mjs）。
// 世界銀行のデータは CC BY 4.0（出典を示して利用）。値は加工せず、国と年と値だけを取り出す。
// 国ごとに調査年が違い、値の無い国もある。推計で埋めない（値が無い国は画面で「データなし」と表示する）。
// 生成AIはこの処理に関与しない。
import { fetchJson } from './lib/http.mjs';
import { readJson } from './lib/safety.mjs';

const { fetchEndpoints, enabledFetchers } = readJson('scripts/allowed-sources.json');

// 指標の定義。range は値として認める範囲（範囲外は異常として除く）
export const WB_INDICATORS = [
  {
    key: 'wbPoverty',
    code: 'SI.POV.DDAY',
    unit: '%',
    decimals: 1,
    range: [0, 100],
    name: { ja: '極度の貧困の割合（1日3.00ドル未満で暮らす人、2021年購買力平価）', en: 'Extreme poverty: share living on less than $3.00 a day (2021 PPP)' },
    note: {
      ja: '世界銀行の国際貧困線（1日3.00ドル、2021年の購買力平価）より低い所得・消費で暮らす人の割合。家計調査のある年だけ値があり、国ごとに調査年が違います。高所得国では値が無いことがあります。',
      en: 'Share of people living below the World Bank international poverty line ($3.00 a day, 2021 PPP). Values exist only for survey years, which differ by country; high-income countries often have no value.',
    },
    source: { name: 'World Bank, Poverty and Inequality Platform', url: 'https://data.worldbank.org/indicator/SI.POV.DDAY' },
  },
  {
    key: 'wbGini',
    code: 'SI.POV.GINI',
    unit: '',
    decimals: 1,
    range: [0, 100],
    name: { ja: '所得の格差（ジニ係数、0〜100）', en: 'Income inequality (Gini index, 0–100)' },
    note: {
      ja: '0は全員の所得が同じ、100は1人がすべてを持つ状態を表します。数字が大きいほど格差が大きい。家計調査のある年だけ値があり、国ごとに調査年が違います。',
      en: '0 means everyone has the same income and 100 means one person has everything; higher means more unequal. Values exist only for survey years, which differ by country.',
    },
    source: { name: 'World Bank, Poverty and Inequality Platform', url: 'https://data.worldbank.org/indicator/SI.POV.GINI' },
  },
  {
    key: 'wbGdpPpp',
    code: 'NY.GDP.PCAP.PP.CD',
    unit: 'intl$',
    decimals: 0,
    range: [0, 500000],
    name: { ja: '1人あたりGDP（購買力平価、国際ドル）', en: 'GDP per capita, PPP (current international $)' },
    note: {
      ja: '国内総生産を人口で割り、物価の違いをならした値（購買力平価）。国の経済の大きさの目安で、一人ひとりの収入や暮らしやすさそのものではありません。',
      en: 'Gross domestic product divided by population, adjusted for price differences (purchasing power parity). A rough measure of the size of the economy, not of individual income or well-being.',
    },
    source: { name: 'World Bank, International Comparison Program / World Development Indicators', url: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.CD' },
  },
  {
    key: 'wbUnemployment',
    code: 'SL.UEM.TOTL.ZS',
    unit: '%',
    decimals: 1,
    range: [0, 100],
    name: { ja: '失業率（ILOの推計、労働力人口に占める割合）', en: 'Unemployment rate (ILO modelled estimate, % of labour force)' },
    note: {
      ja: '国際労働機関（ILO）が国際比較のためにそろえた推計値で、各国の政府が発表する失業率とは異なることがあります。',
      en: 'Modelled estimates by the International Labour Organization for international comparison; they may differ from national official figures.',
    },
    source: { name: 'International Labour Organization, ILOSTAT (via World Bank)', url: 'https://data.worldbank.org/indicator/SL.UEM.TOTL.ZS' },
  },
];

const MAX_RECORDS = 2000;
const YEAR = /^(19|20)\d{2}$/;

// 応答（[ページ情報, データの配列]）を、{ ISO3: [値, 年] } に直す。形の異常は例外、1件の異常はその件だけ除く。
// countryIds：表示する国・地域（site/data/geo/country-index.json の id）。地域の集計（世界・EU など）は含めない
export function parseWorldBank(doc, ind, countryIds, now = Date.now()) {
  if (!Array.isArray(doc) || doc.length < 2 || !doc[0] || typeof doc[0] !== 'object' || Array.isArray(doc[0])) throw new Error(`${ind.code}: unexpected response shape`);
  if (doc[0].message) throw new Error(`${ind.code}: API error`);
  const rows = doc[1];
  if (!Array.isArray(rows) || rows.length > MAX_RECORDS) throw new Error(`${ind.code}: unexpected data array`);
  const thisYear = new Date(now).getUTCFullYear();
  const values = {};
  let errors = 0;
  for (const r of rows) {
    try {
      if (!r || typeof r !== 'object') throw new Error('row');
      if (r.indicator?.id !== ind.code) throw new Error('indicator');
      const iso = typeof r.countryiso3code === 'string' ? r.countryiso3code : '';
      if (!countryIds.has(iso)) continue; // 地域の集計・地図に無い地域は除く（正常な除外）
      if (r.value === null || r.value === undefined || r.value === '') continue; // 値なし（正常）
      const v = typeof r.value === 'number' ? r.value : NaN;
      if (!Number.isFinite(v) || v < ind.range[0] || v > ind.range[1]) throw new Error('value');
      const y = String(r.date || '');
      if (!YEAR.test(y) || Number(y) < 1990 || Number(y) > thisYear) throw new Error('year');
      const prev = values[iso];
      if (!prev || Number(y) > prev[1]) values[iso] = [Number(v.toFixed(Math.max(ind.decimals, 2))), Number(y)];
    } catch {
      errors++;
    }
  }
  return { values, count: Object.keys(values).length, errors, raw: rows.length };
}

// 1つの指標を取得する。失敗しても例外を投げず、状態を返す（ほかの指標・ほかの分野の公開を止めない）
async function fetchOne(ind, countryIds) {
  try {
    const got = parseWorldBank(await fetchJson(fetchEndpoints[ind.key]), ind, countryIds);
    // 値が1件も無い、または異常が多すぎる（半分以上）ときは、壊れた応答の疑いとして使わない
    if (!got.count || got.errors > got.raw / 2) return { status: 'invalid', values: {}, count: 0 };
    return { status: 'ok', ...got };
  } catch (e) {
    console.log(`::warning::${ind.key} を取得できなかった（${e.message}）`);
    return { status: 'failed', values: {}, count: 0 };
  }
}

// 「世界をくらべる」用のデータ一式。offline（ネットなしの確認版）は取得しない
export async function buildCompare({ countryIds, offline, now }) {
  const indicators = [];
  for (const ind of WB_INDICATORS) {
    const base = { key: ind.key, code: ind.code, unit: ind.unit, decimals: ind.decimals, name: ind.name, note: ind.note, source: ind.source };
    if (!enabledFetchers[ind.key] || !fetchEndpoints[ind.key]) indicators.push({ ...base, status: 'disabled', values: {}, count: 0 });
    else if (offline) indicators.push({ ...base, status: 'notFetched', values: {}, count: 0 });
    else {
      const r = await fetchOne(ind, countryIds);
      indicators.push({ ...base, status: r.status, values: r.values, count: r.count });
    }
  }
  return { retrievedAt: offline ? null : now.toISOString(), indicators };
}
