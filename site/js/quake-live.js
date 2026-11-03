// 地震の分野を開いているあいだだけ、見ている人のブラウザが USGS（米国地質調査所）の公開データを直接読み込み、
// 1日3回の組み立て時の一覧より新しい地震を足す（GitHub の定時実行の遅れに左右されないようにするため）。
//
// 安全のための決まり（docs/SECURITY-DESIGN.md）：
//   - 通信先は下の FEED の1か所だけ（CSP の connect-src でも、この1か所以外への通信をブラウザが拒否する）
//   - 送るのは通常の読み込み要求だけ。Cookie などの認証情報・参照元（リファラー）は送らない
//   - 応答は大きさと時間に上限を設け、形を厳しく調べ、組み立て時と同じ決まり（quake-core.js）で1件ずつ変換する
//   - 画面には文字としてだけ出す（textContent。HTML として解釈しない）。リンクは USGS の地震のページの形のものだけ
//   - 読み込めなくても、組み立て時の一覧をそのまま表示する（失敗しても壊れない）
import { normalizeQuakeWith, mergeQuakes } from './quake-core.js';
import { makeCountryMatcher } from './country-aliases.js';

const FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';
const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 10000;
// 組み立て時の決まり（scripts/importance-rules.mjs の RULES.quake・SHOW.max）と同じ値
export const LIVE_RULES = { keepDays: 30, majorWithinDays: 7, max: 100 };

// 表示偽装に使われる文字を除き、タグの形の文字を取り除き、長さをそろえる（画面には textContent でだけ出す）
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\u115F\u1160\u3164\uFFA0\u2800\u2028\u2029\u034F\uFE00-\uFE0F]/gu;
export function cleanPlace(value, maxLength) {
  let prev,
    t = String(value);
  do {
    prev = t;
    t = t.replace(/<[^<>]*>?/g, ' ');
  } while (t !== prev);
  t = t.replace(INVISIBLE, ' ').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...t];
  return chars.length > maxLength ? chars.slice(0, maxLength - 1).join('') + '…' : t;
}

// USGS の地震のページの URL だけを認める（組み立てない。応答の url を調べて、id と一致するものだけ使う）
export function usgsEventUrl(id, props) {
  try {
    const u = new URL(String(props?.url || ''));
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null;
    if (u.hostname !== 'earthquake.usgs.gov') return null;
    if (u.pathname !== '/earthquakes/eventpage/' + id) return null;
    return u.href;
  } catch {
    return null;
  }
}

// 応答（JSON を読んだもの）を、表示用の一覧に変換する。形の異常な項目は除く
export function parseLiveQuakes(doc, countries, now = Date.now()) {
  if (!doc || doc.type !== 'FeatureCollection' || !Array.isArray(doc.features) || doc.features.length > 5000) throw new Error('unexpected response');
  const matchCountryList = makeCountryMatcher(countries);
  const items = [];
  for (const f of doc.features) {
    try {
      const it = normalizeQuakeWith(f, now, { ...LIVE_RULES, matchCountryList, clean: cleanPlace, eventUrl: usgsEventUrl });
      if (it) items.push(it);
    } catch {
      /* 形の異常な1件は除く */
    }
  }
  return items;
}

async function fetchFeed() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(FEED, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('too large');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('too large');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

// 直接取得して、data.layers.quake と data.meta.layers.quake を更新する。成功したら true
export async function refreshQuakes(data, now = Date.now()) {
  const doc = data.layers.quake;
  if (!doc || doc.status === 'preparing') return false;
  const fresh = parseLiveQuakes(await fetchFeed(), data.countries, now);
  const items = mergeQuakes(fresh, doc.items, now, LIVE_RULES);
  data.layers.quake = { ...doc, status: undefined, items };
  data.meta.layers.quake = { ...(data.meta.layers.quake || {}), kind: 'auto', count: items.length, retrievedAt: new Date(now).toISOString(), live: true };
  return true;
}
