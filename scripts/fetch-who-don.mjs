// WHO 疾病発生ニュース（Disease Outbreak News）を取得し、表示用の項目に変換する。
// AIは一切関与しない決まった処理。本文は転載せず、タイトル・公表日・国・原典リンクのみ扱う。

import './lib/node-guard.mjs';
import { fetchJson } from './lib/http.mjs';
import { cleanText, stripTags, isValidDate, toIsoDate, isAllowedUrl, readJson } from './lib/safety.mjs';
import { matchCountryList, GLOBAL_WORDS } from './lib/countries.mjs';
import { outbreakImportance, withinDays, RULES } from './importance-rules.mjs';

const { fetchEndpoints } = readJson('scripts/allowed-sources.json');
const DICT = readJson('scripts/disease-names-ja.json').terms.sort((a, b) => b[0].length - a[0].length);
const ITEM_BASE = 'https://www.who.int/emergencies/disease-outbreak-news/item/';
const SLUG = /^[A-Za-z0-9-]{3,120}$/;

// 「病名 – 国名」形式のタイトルを分解する（区切りは前後に空白のあるダッシュ）
// 区切りがダッシュでなくカンマの見出し（例：「…, Democratic Republic of the Congo & Uganda」）は、
// カンマの後ろが国名として読める場合だけ分ける
function splitTitle(title) {
  const m = title.match(/^(.*\S)\s+[–—-]\s+(.+)$/);
  if (m) return { disease: m[1].trim(), place: m[2].trim() };
  const c = title.match(/^(.*\S),\s+([^,]+)$/);
  if (c && (matchCountryList(c[2].trim().replace(/\s*&\s*/g, ' and ')) || GLOBAL_WORDS.test(c[2]))) return { disease: c[1].trim(), place: c[2].trim() };
  return { disease: title, place: '' };
}

function diseaseJa(disease) {
  for (const [en, ja] of DICT) {
    if (disease.includes(en)) return disease === en ? ja : `${ja}（原文：${disease}）`;
  }
  return null;
}

export function normalizeDon(raw, now = Date.now()) {
  const title = cleanText(stripTags(raw.UseOverrideTitle && raw.OverrideTitle ? raw.OverrideTitle : raw.Title || ''), 300);
  const published = raw.PublicationDate || raw.PublicationDateAndTime;
  const slug = typeof raw.UrlName === 'string' ? raw.UrlName.trim() : '';
  if (!title || !isValidDate(published) || !SLUG.test(slug)) return null;
  const url = ITEM_BASE + encodeURIComponent(slug);
  if (!isAllowedUrl(url)) return null;
  const publishedAt = toIsoDate(published);
  if (!withinDays(publishedAt, RULES.outbreak.keepDays, now)) return null;

  const { disease, place } = splitTitle(title);
  let countries = [];
  let placeBasis = 'unknown';
  if (place && GLOBAL_WORDS.test(place)) placeBasis = 'global';
  else if (place) {
    const ids = matchCountryList(place.replace(/\s*&\s*/g, ' and '));
    if (ids) {
      countries = ids;
      placeBasis = 'reported_country';
    }
  }
  const ja = diseaseJa(disease);
  return {
    id: 'who-' + slug.toLowerCase(),
    layer: 'outbreak',
    // 英語表示では原文タイトルをそのまま使う（機械翻訳しない）
    title: { ja: ja ? `${ja}${place ? '｜' + place : ''}` : title, en: title, original: title },
    topic: disease.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'unknown',
    countries,
    placeBasis,
    importance: outbreakImportance(publishedAt, now),
    publishedAt,
    source: { name: 'WHO Disease Outbreak News', url },
  };
}

// 取得済みの一覧（API の応答と同じ形）を表示用の項目に変換する。スナップショット確認でも同じ処理を通す
export function processDonList(list, now = Date.now()) {
  const items = list.map((r) => normalizeDon(r, now)).filter(Boolean);
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return items;
}

export async function fetchOutbreaks() {
  const base = fetchEndpoints.whoDon;
  let data;
  try {
    data = await fetchJson(`${base}?$orderby=PublicationDate%20desc&$top=100`);
  } catch {
    data = await fetchJson(base); // 並べ替え指定に対応していない場合は全件取得して手元で並べる
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.value) ? data.value : null;
  if (!list) throw new Error('WHO DON: unexpected response shape');
  if (list.length < 5) throw new Error(`WHO DON: too few items (${list.length}) — 異常とみなして公開を中止`);
  return processDonList(list);
}
