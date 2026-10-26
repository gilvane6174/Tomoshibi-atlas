// 「今日の動物たち」：豆知識の一覧から、その日の分を日付だけで決めて選ぶ（同じ日なら何度組み立てても同じ結果）。
// 1日2回の公開でも、日本時間の日付が同じなら同じ動物が出る。外部への通信はしない。
import { createHash } from 'node:crypto';

export const DAILY_COUNT = 20; // 各分野の表示件数（20〜30件）の下限にそろえる

const score = (date, id) => createHash('sha256').update(`${date}|${id}`).digest('hex');

// 日付（YYYY-MM-DD、日本時間）から、国が重ならないように最大 DAILY_COUNT 件を選ぶ
export function pickDaily(facts, date, count = DAILY_COUNT) {
  const sorted = [...facts].sort((a, b) => (score(date, a.id) < score(date, b.id) ? -1 : 1));
  const used = new Set();
  const out = [];
  for (const f of sorted) {
    if (used.has(f.country)) continue;
    used.add(f.country);
    out.push(f);
    if (out.length >= count) break;
  }
  return out;
}

// 地球儀・一覧で表示する項目の形にする
export function toItems(facts, date) {
  return facts.map((f) => ({
    id: f.id,
    layer: 'animals',
    title: { ja: f.animal.ja, en: f.animal.en },
    summary: { ja: f.text.ja, en: f.text.en },
    tags: [],
    countries: [f.country],
    placeBasis: 'reported_country',
    importance: 'major',
    publishedAt: date,
    checkedAt: f.checkedAt,
    source: { name: f.source.name, url: f.source.url },
  }));
}
