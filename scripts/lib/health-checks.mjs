// 「急な病気・けがのとき」のページ（命にかかわる情報）のリンクは、運用者（人間）が月に1回、リンク先の中身まで確かめる。
// 記録は data/curated/health-checks.json（運用者だけが scripts/mark-health-checked.mjs で書く。AI・bot は書かない）。
// まだ一度も確認していないリンクは、組み立てのときにリンクを外して「確認待ち」と表示する。
// 一度確認したリンクは、期限（HUMAN_CHECK_DAYS 日）を過ぎても外さない（運用者の決定 2026-11-20）。期限切れは毎週の一覧で知らせ続ける。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CODE_ROOT, readData } from './safety.mjs';
import { ER_SOURCE } from './static-pages.mjs';

// 毎月1回の確認に、2週間ほどの余裕を足した日数
export const HUMAN_CHECK_DAYS = 45;
export const KIDS_8000_URL = 'https://kakarikata.mhlw.go.jp/kakaritsuke/8000.html';
export const EMERGENCY_PAGE = 'emergency-care.html';

export function readHealthChecks() {
  try {
    return readData('data/curated/health-checks.json').checks || {};
  } catch {
    return {};
  }
}

// 人間の確認が必要なリンクの一覧（URL → どこにあるか）
export function emergencyUrls() {
  const urls = new Map();
  const add = (u, where) => {
    if (!urls.has(u)) urls.set(u, where);
  };
  const html = readFileSync(resolve(CODE_ROOT, 'site', EMERGENCY_PAGE), 'utf8');
  for (const m of html.matchAll(/href="(https:\/\/[^"]+)"/g)) add(m[1].replace(/&amp;/g, '&'), 'health page');
  for (const it of readData('data/curated/health-guide.json').items) for (const l of it.links) add(l.url, `health ${it.id}`);
  add(ER_SOURCE.url, 'health er7119');
  add(KIDS_8000_URL, 'health er8000');
  return urls;
}

const DAY = 86400000;
// 確認からの日数（記録が無ければ null）
export function daysSinceCheck(url, checks, now = new Date()) {
  const d = checks[url];
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00+09:00`);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / DAY);
}
// 期限内に確認したか（知らせの判定に使う）
export function isHumanChecked(url, checks, now = new Date()) {
  const n = daysSinceCheck(url, checks, now);
  return n !== null && n >= 0 && n <= HUMAN_CHECK_DAYS;
}
// サイトに載せてよいか：一度でも人が確認していれば載せる（期限切れでも消さない）
export function isEverChecked(url, checks, now = new Date()) {
  const n = daysSinceCheck(url, checks, now);
  return n !== null && n >= 0;
}

// 人の確認が必要なリンク（週1回のリンク確認で毎週計算する。外部への通信はしない。自動の検査の結果とは別に数える）
//  - 毎月最初の週（日本時間の1〜7日）：今月まだ確認していないリンクすべて（前の月に確認したものも、毎月確かめ直す）
//  - それ以外の週：確認していない・確認から WARN_DAYS 日を過ぎた（期限が近い）リンク
export const WARN_DAYS = 31;
const jstParts = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d);
export function humanDue(urls, checks, now = new Date()) {
  const today = jstParts(now);
  const monthStart = today.slice(0, 8) + '01';
  const monthly = Number(today.slice(8, 10)) <= 7;
  const out = [];
  for (const [url, where] of urls) {
    const n = daysSinceCheck(url, checks, now);
    const checkedThisMonth = typeof checks[url] === 'string' && checks[url] >= monthStart;
    if (n === null || n < 0) out.push({ url, where, days: null, reason: '未確認' });
    else if (n > HUMAN_CHECK_DAYS) out.push({ url, where, days: n, reason: `期限切れ（${n}日前に確認。リンクは載せたまま。早めに確認を）` });
    else if (monthly && !checkedThisMonth) out.push({ url, where, days: n, reason: `今月の確認がまだ（前回 ${n}日前）` });
    else if (n > WARN_DAYS) out.push({ url, where, days: n, reason: `期限が近い（${n}日前に確認。期限は${HUMAN_CHECK_DAYS}日）` });
  }
  return out;
}

// 本番の公開（GitHub Actions で --offline なしに組み立てるとき）だけ、運用者がまだ確かめていない
// 救急の電話相談の時間・番号と、急な病気・けがのリンクを出さない。手元の確認版では、確かめる前から全部出す（運用者の決定 2026-11-21）
export function strictPublish(env = process.env, argv = process.argv) {
  return env.GITHUB_ACTIONS === 'true' && !argv.includes('--offline');
}
