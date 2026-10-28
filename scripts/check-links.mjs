// 掲載しているリンク先が「安全に開けるか」を定期的に確かめる（GitHub Actions で週1回。手元でも実行可）。
// 結果は3つに分ける：
//   危険（要対応）    … 証明書エラー・ページが無い・停止中・改ざんや不正な埋め込みの兆候・http や許可外への転送
//   要確認（人の目で） … 自動アクセスの拒否（403/429）・中身が空・時間切れ・別ドメインへの転送
//   合格               … 最終的な行き先まで開けて、上の兆候が無い
// 「要確認」は安全の確認ができていないという意味。危険・要確認が1件でもあれば終了コード1（通知が届く）。
// 転送は最大5回まで実際にたどり、最終的な行き先のページも同じ基準で調べる。
// アクセスは1件ずつ、間隔をあけて行う（相手のサーバーに負担をかけない）。秘密情報は使わない。
// 対象：リンク集・都道府県の窓口リンク（どちらもサイトに表示しているものだけ）・手動掲載の原典とリンク・今日の動物たちの原典・説明ページなどの HTML 内のリンク。
//       自動取得の WHO・CISA・NVD の個別ページは、許可リストの公的機関のドメインで毎日作られるため対象外。
//       X（旧Twitter）は自動アクセスを受け付けないため対象外（各機関の公式サイトの掲載で確認する）。
import './lib/node-guard.mjs';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isShownLink } from './lib/link-shown.mjs';
import { resolve } from 'node:path';
import { readData, isDirectoryUrl, isAllowedUrl, isAnimalUrl, CODE_ROOT } from './lib/safety.mjs';

// 改ざん（不正な埋め込み）の兆候。英語の語は単語の区切りで判定する（specialist の中の cialis などで誤検知しない）。
const SPAM_WORDS = /\b(slot\s*gacor|judi\s*(bola|online)|togel|sbobet|situs\s*slot|casino\s*online|online\s*casino|exam\s*dumps|viagra|cialis|replica\s*watches)\b/i;
// 日本語の語は、警察・法律相談などの公的な注意喚起の本文に普通に出てくるため、外部サイトへのリンクの文字・行き先にあるときだけ数える
const SPAM_JA = /オンラインカジノ|闇バイト|ネットカジノ/;
const PARKED = /(this domain (is|may be) for sale|domain parking|buy this domain|under construction|site (is )?under maintenance|temporarily (unavailable|down for maintenance)|メンテナンス中|ただいまメンテナンス)/i;
// 停止・メンテナンスの表示は、本文が短いページ（停止中の案内だけのページ）のときだけ数える。通常のページの「メンテナンス中は…」の予告で誤検知しない
const PARKED_MAX_TEXT = 3000;
const UA = 'TomoshibiAtlasLinkCheck/1.0 (+non-profit; weekly link safety check)';
const TIMEOUT_MS = 12000;
const WAIT_MS = 1200;
const BUDGET_MS = 40 * 60 * 1000; // 全体の時間の上限（ワークフローの制限時間より短く）
const started = Date.now();

// 調べる URL を集める（通信はしない）。表示していないリンク（確認の記録が無い・URL が一致しない・確認日が無い）は運用者の確認待ちなので集めない
export function collectUrls() {
  const urls = new Map();
  const add = (url, where) => typeof url === 'string' && url.startsWith('https://') && !/^https:\/\/(x|twitter)\.com\//.test(url) && (urls.has(url) || urls.set(url, where));
  const dir = readData('data/directory/links.json');
  const ev = readData('data/directory/evidence.json').links;
  const isShown = (l) => isShownLink(l, ev);
  for (const [cid, block] of Object.entries(dir.countries)) for (const links of Object.values(block)) for (const l of links) if (isShown(l)) add(l.url, `${cid} ${l.id}`);
  for (const links of Object.values(dir.international)) for (const l of links) if (isShown(l)) add(l.url, `INTL ${l.id}`);
  // 日本の都道府県の福祉ページ（福祉の探し方ページで表示するもの）
  for (const p of readData('data/directory/prefectures.json').prefectures) for (const l of p.links || []) if (isShown(l)) add(l.url, `JP-${p.code} ${l.id}`);
  for (const it of readData('data/curated/entries.json').items) {
    add(it.source.url, `entries ${it.id}`);
    for (const l of it.links || []) add(l.url, `entries ${it.id}`);
  }
  for (const f of readData('data/curated/animals.json').facts) add(f.source.url, `animals ${f.id}`);
  for (const name of readdirSync(resolve(CODE_ROOT, 'site')).filter((n) => n.endsWith('.html'))) {
    const html = readFileSync(resolve(CODE_ROOT, 'site', name), 'utf8');
    for (const m of html.matchAll(/href="(https:\/\/[^"]+)"/g)) add(m[1].replace(/&amp;/g, '&'), `site/${name}`);
  }
  return { urls, ev };
}

const allowed = (u) => {
  const bare = u.split('#')[0].split('?')[0];
  return isDirectoryUrl(bare) || isAllowedUrl(bare) || isAnimalUrl(bare) || /^https:\/\/docs\.google\.com\/forms\//.test(u);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const danger = [];
const review = [];
let ok = 0;
let skipped = 0;

// 本文は最大 MAX_BODY バイトまでしか受け取らない（巨大な応答で止まらないように）
const MAX_BODY = 600_000;
// タグを除いた文字数（長さの目安を取るだけ。表示や書き出しには使わない）。入れ子・閉じ忘れでも残らないよう、変わらなくなるまで繰り返す
export function visibleLength(html) {
  let prev, t = String(html);
  do { prev = t; t = t.replace(/<[^<>]*>?/g, ''); } while (t !== prev);
  return t.replace(/[<>]/g, '').trim().length;
}

// ページの「見える文字」と「外部へのリンク」を取り出す（判定だけに使う。表示や書き出しには使わない）。
// script・style・コメントの中身は除く（プログラムや埋め込み画像の符号の偶然の一致で誤検知しないため）
export function pageSignals(html, pageUrl) {
  let t = String(html), prev;
  do {
    prev = t;
    t = t.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(/<(script|style)\b[\s\S]*?(?:<\/\1\b[^>]*>|$)/gi, ' ');
  } while (t !== prev);
  const external = [];
  let host = '';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch {}
  for (const m of t.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']?([^"'\s>]+)[^>]*>([\s\S]*?)<\/a\b/gi)) {
    let h = '';
    try { h = new URL(m[1], pageUrl).hostname.replace(/^www\./, ''); } catch { continue; }
    if (h && h !== host && !h.endsWith('.' + host)) external.push(`${m[1]} ${m[2]}`);
  }
  let text = t;
  do { prev = text; text = text.replace(/<[^<>]*>?/g, ' '); } while (text !== prev);
  text = text.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return { text, external: external.join('\n') };
}
export function judgeContent(html, pageUrl) {
  const { text, external } = pageSignals(html, pageUrl);
  if (SPAM_WORDS.test(text) || SPAM_WORDS.test(external) || SPAM_JA.test(external)) return 'spam';
  if (text.length < PARKED_MAX_TEXT && PARKED.test(text)) return 'parked';
  return '';
}

// 実行結果の要約（Markdown）に書くとき、取得先から返った文字（エラー文など）で表示を崩されないよう、記号を無害化する
export function mdSafe(s) {
  return String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\\`*_{}\[\]<>()#!|~&]/g, (c) => `&#${c.charCodeAt(0)};`);
}

const sameSite = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

async function readLimited(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < MAX_BODY) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BODY));
}

// 転送は全体で最大5回まで（別ドメインへの転送も同じ回数に数える）。同じURLへ戻る転送はその時点で止める。
async function inspect(url) {
  let current = url;
  let crossDomain = '';
  const visited = new Set([url]);
  for (let hop = 0; hop <= 5; hop++) {
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': UA } });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      const next = new URL(res.headers.get('location') || '', current).href;
      if (!next.startsWith('https://')) return ['danger', `http など暗号化されていない行き先へ転送（${next}）`];
      if (!allowed(next)) return ['danger', `許可リスト外のサイトへ転送（${next}）`];
      if (visited.has(next)) return ['danger', '転送が循環している'];
      visited.add(next);
      // www の有無だけの違い（同じ機関のサイト）は別ドメインとして扱わない
      if (sameSite(new URL(next).hostname, new URL(url).hostname) === false) crossDomain = next;
      current = next;
      continue;
    }
    if (res.status === 403 || res.status === 429) {
      await res.body?.cancel().catch(() => {});
      return ['review', `自動アクセスを拒否（${res.status}）。ブラウザで開いて確認する`];
    }
    if (res.status >= 400) {
      await res.body?.cancel().catch(() => {});
      return ['danger', `ページが開けない（${res.status}）`];
    }
    const text = await readLimited(res);
    const sign = judgeContent(text, current);
    if (sign === 'spam') return ['danger', '改ざん・不正な埋め込みの疑い' + (crossDomain ? `（転送先 ${crossDomain}）` : '')];
    if (sign === 'parked') return ['danger', 'メンテナンス中・停止の疑い' + (crossDomain ? `（転送先 ${crossDomain}）` : '')];
    if (visibleLength(text) < 200) return ['review', '中身がほとんど空（JavaScript でしか表示されない、または停止の可能性）'];
    // 別ドメインへの転送は、行き先が問題なくても「要確認」（掲載URLを新しい公式URLに直すべきか人が判断する）
    if (crossDomain) return ['review', `別ドメインへ転送（${crossDomain}）。正しい公式の移転なら掲載URLを書き換える`];
    return ['ok', hop ? `同じサイト内で${hop}回転送` : ''];
  }
  return ['danger', '転送が多すぎる'];
}

async function run() {
  const { urls, ev } = collectUrls();
// 運用者がブラウザで確認済みの「自動アクセスだけを拒否するサイト」（evidence.json の autoCheck が "blocked-ok"）は、
// 拒否（403/429）・中身が空のときに失敗にせず「既知」として一覧に出す（毎週の通知が当たり前にならないように）。
// 危険（証明書・404・改ざん・転送など）は、既知でも必ず失敗にする。
const knownBlocked = new Set(Object.values(ev).filter((e) => e.autoCheck === 'blocked-ok').map((e) => e.url));
const known = [];

for (const [url, where] of urls) {
  if (Date.now() - started > BUDGET_MS) {
    skipped++;
    continue;
  }
  try {
    const [kind, why] = await inspect(url);
    if (kind === 'ok') ok++;
    else if (kind === 'review' && knownBlocked.has(url) && /拒否|中身がほとんど空/.test(why)) known.push(`${where}: ${why}（${url}）`);
    else (kind === 'danger' ? danger : review).push(`${where}: ${why}（${url}）`);
  } catch (e) {
    const msg = String(e?.cause?.code || e?.name || e);
    if (/CERT|SSL|TLS|SELF_SIGNED|ALTNAME|EXPIRED|UNABLE_TO|VERIFY|ISSUER/i.test(msg)) danger.push(`${where}: HTTPS の証明書に問題（ブラウザで警告が出る）（${url}）`);
    // ドメインが引けない（ENOTFOUND）＝ドメインが失効し、第三者に取得されるおそれ。既知でも必ず危険にする
    else if (/ENOTFOUND|EAI_NONAME/i.test(msg)) danger.push(`${where}: ドメインが見つからない（失効の可能性。第三者に取得されると危険）（${url}）`);
    // 既知として扱うのは、時間切れ・接続の切断だけ（運用者がブラウザで確認済みの、自動アクセスを嫌うサイト）
    else if (knownBlocked.has(url) && /TimeoutError|AbortError|ECONNRESET|UND_ERR_SOCKET/i.test(msg)) known.push(`${where}: 接続できない・時間切れ（${msg}）（${url}）`);
    else review.push(`${where}: 接続できない・時間切れ（${msg}）（${url}）`);
  }
  await sleep(WAIT_MS);
}

const report = [
  `# リンクの安全確認（${urls.size}件）`,
  `合格 ${ok}件／危険 ${danger.length}件／要確認 ${review.length}件／既知（ブラウザで確認済み・自動アクセスのみ拒否）${known.length}件${skipped ? `／時間切れで未確認 ${skipped}件` : ''}`,
  '',
  `## 危険（要対応：掲載から外すか、公式の新しいURLに差し替える）`,
  ...danger.map((p) => `- ${p}`),
  '',
  `## 要確認（安全を確認できていない。ブラウザで開いて確かめるまで、新しく掲載しない）`,
  ...review.map((p) => `- ${p}`),
  '',
  `## 既知（失敗にしない。ブラウザで確認済みのサイトが自動アクセスだけを拒否している。月に1回はブラウザで開いて確かめる）`,
  ...known.map((p) => `- ${p}`),
].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.split('\n').map((l) => (l.startsWith('- ') ? `- ${mdSafe(l.slice(2))}` : l)).join('\n') + '\n');
process.exit(danger.length || review.length || skipped ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
