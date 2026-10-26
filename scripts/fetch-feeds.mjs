// 防犯・防災・研究と対策の「公的機関の新着の見出し」を自動で取得する（RSS / Atom）。
// 表示するのは見出し・公表日・原典へのリンク・発表した機関の国だけ。本文は取得しない・載せない。
// 使えるのは、利用条件を一次情報で確認できた情報源だけ（scripts/allowed-sources.json の enabledFetchers で個別に有効化）。
// 日本の省庁の多くは、RSS を使ったホームページの作成や再配布を断っているため使わない（例：厚生労働省・警察庁・内閣府）。
// 取得できなくても公開は止めない（その情報源の項目が無いだけ）。項目ごとの異常は、その項目だけ除く。
import { createHash } from 'node:crypto';
import { fetchBytes } from './lib/http.mjs';
import { readJson, cleanText, stripTags, isAllowedUrl } from './lib/safety.mjs';
import { parseFeed } from './lib/feed.mjs';
import { withinDays } from './importance-rules.mjs';

const { fetchEndpoints, enabledFetchers } = readJson('scripts/allowed-sources.json');

// 情報源の定義。maxShown は、1つの情報源が分野を埋め尽くさないための表示上限（新しい順）。host は、リンク先として認めるホスト（ほかのホストへのリンクは異常として除く）
export const FEEDS = [
  {
    key: 'fsaNews',
    layer: 'crime',
    country: 'JPN',
    lang: 'ja',
    host: 'www.fsa.go.jp',
    source: '金融庁（新着情報）',
    // 新着のうち、詐欺・無登録業者などの注意喚起だけを拾う
    filter: /詐欺|無登録|なりすまし|偽の|偽サイト|フィッシング|注意喚起|悪質/,
    maxShown: 8,
  },
  { key: 'ftcConsumer', layer: 'crime', country: 'USA', lang: 'en', host: 'www.ftc.gov', source: 'US Federal Trade Commission (FTC) consumer protection news', maxShown: 6 },
  { key: 'ncscNews', layer: 'crime', country: 'GBR', lang: 'en', host: 'www.ncsc.gov.uk', source: 'UK National Cyber Security Centre (NCSC) news', maxShown: 6 },
  // 同じ災害の続報（第1報、第2報…）は「以前の情報」として最新の報だけを目立たせる（topicSeries）。
  // 消防庁の災害情報は、リンクが一覧ページへの相対パス＋ページ内の目印（例：/disaster/info/#070300）で、
  // pubDate は第1報の日付のまま。見出しの「（第3報・R8.10.26更新）」の更新日を公表日として使う（titleDate）
  {
    key: 'fdmaDisaster',
    layer: 'disaster',
    country: 'JPN',
    lang: 'ja',
    host: 'www.fdma.go.jp',
    source: '総務省消防庁（災害情報）',
    maxShown: 10,
    topicSeries: /[（(]\s*第\s*[0-9０-９]+\s*報[^）)]*[）)]/g,
    titleDate: 'reiwaUpdated',
  },
  { key: 'cdcMmwr', layer: 'research', country: 'USA', lang: 'en', host: 'www.cdc.gov', source: 'US CDC Morbidity and Mortality Weekly Report (MMWR)', maxShown: 8 },
];

export const FEED_KEEP_DAYS = 180; // これより古い見出しは取り込まない
export const FEED_MAJOR_DAYS = 7; // 公表から7日以内は大きく表示（新しさだけで決める）

const malformed = (why) => {
  throw new Error('feed item malformed: ' + why);
};

// 1件を表示用の項目にする。対象外（キーワードに合わない・古い）は null、形の異常は例外
// 見出しの「R8.10.26更新」（令和の年.月.日）を日本時間の日付として読む。読めなければ null
export function reiwaUpdatedDate(title) {
  const m = /R\s*([0-9０-９]{1,2})\s*[.．]\s*([0-9０-９]{1,2})\s*[.．]\s*([0-9０-９]{1,2})\s*更新/.exec(title);
  if (!m) return null;
  const n = (x) => Number(x.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  const [y, mo, d] = [n(m[1]) + 2018, n(m[2]), n(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.parse(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+09:00`);
  return Number.isFinite(t) && new Date(t + 9 * 3600000).getUTCDate() === d ? t : null;
}

// base：相対パスのリンクを解決するための取得先URL（消防庁の災害情報など）
export function normalizeFeedItem(feed, raw, now = Date.now(), base = undefined) {
  const title = cleanText(stripTags(String(raw?.title || '')), 240);
  if (!title) malformed('title');
  let u;
  try {
    u = new URL(String(raw.link || ''), base);
  } catch {
    malformed('link');
  }
  if (u.protocol !== 'https:' || u.hostname !== feed.host || u.username || u.password || u.port) malformed('link host');
  // ページ内の目印（#以降）は項目を見分けるためにだけ使い、リンクからは外す（このサイトのリンクは # を含めない）
  const idSource = u.href;
  u.hash = '';
  const link = u.href;
  if (!isAllowedUrl(link)) malformed('link not allowed');
  let t = raw.date;
  if (feed.titleDate === 'reiwaUpdated') {
    const upd = reiwaUpdatedDate(title);
    if (upd !== null && (!Number.isFinite(t) || upd >= t)) t = upd;
  }
  if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > now + 2 * 86400000) malformed('date');
  const publishedAt = new Date(t).toISOString();
  if (!withinDays(publishedAt, FEED_KEEP_DAYS, now)) return null;
  if (feed.filter && !feed.filter.test(title)) return null;
  const series = feed.topicSeries ? title.replace(feed.topicSeries, '').replace(/\s+/g, '') : null;
  return {
    ...(series ? { topic: `${feed.key.toLowerCase()}-${createHash('sha256').update(series).digest('hex').slice(0, 12)}` } : {}),
    id: `${feed.key.toLowerCase()}-${createHash('sha256').update(idSource).digest('hex').slice(0, 16)}`,
    layer: feed.layer,
    // 見出しは原文のまま（機械翻訳しない）。日本語の情報源は日本語、英語の情報源は英語だけ
    title: feed.lang === 'ja' ? { ja: title } : { en: title, original: title },
    tags: [],
    countries: [feed.country],
    placeBasis: 'publisher_country',
    importance: withinDays(publishedAt, FEED_MAJOR_DAYS, now) ? 'major' : 'minor',
    publishedAt,
    source: { name: feed.source, url: link },
  };
}

export function inspectFeed(feed, xml, now = Date.now(), base = fetchEndpoints[feed.key]) {
  const list = parseFeed(xml); // 応答全体の形が異常なら例外（取得失敗として扱う）
  const items = [];
  const seen = new Set();
  let errors = 0;
  for (const raw of list) {
    try {
      const it = normalizeFeedItem(feed, raw, now, base);
      if (it && !seen.has(it.id)) {
        seen.add(it.id);
        items.push(it);
      }
    } catch {
      errors++;
    }
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { items, raw: list.length, errors };
}

// XML 宣言の文字コード（UTF-8 / Shift_JIS / EUC-JP）で読む。それ以外の指定や不正なバイト列は失敗にする
const ENCODINGS = { 'utf-8': 'utf-8', utf8: 'utf-8', shift_jis: 'shift_jis', 'shift-jis': 'shift_jis', sjis: 'shift_jis', 'windows-31j': 'shift_jis', 'euc-jp': 'euc-jp' };
export function decodeFeed(bytes) {
  const head = Buffer.from(bytes.subarray(0, 200)).toString('latin1');
  const m = /<\?xml[^>]*encoding=["']([A-Za-z0-9_-]+)["']/i.exec(head);
  const enc = m ? ENCODINGS[m[1].toLowerCase()] : 'utf-8';
  if (!enc) throw new Error(`feed: unsupported encoding ${m[1]}`);
  return new TextDecoder(enc, { fatal: true }).decode(bytes);
}

// 有効な情報源だけを、1回ずつ取得する（予備の取得先は無い）。結果は情報源ごと
export async function fetchFeeds() {
  const results = {};
  for (const feed of FEEDS) {
    if (!enabledFetchers[feed.key]) continue;
    try {
      results[feed.key] = { feed, ...inspectFeed(feed, decodeFeed(await fetchBytes(fetchEndpoints[feed.key]))) };
    } catch (e) {
      results[feed.key] = { feed, error: e.message };
    }
  }
  return results;
}
