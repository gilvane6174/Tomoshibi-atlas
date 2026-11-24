// 掲載しているリンク先が「安全に開けるか」を定期的に確かめる（GitHub Actions で週1回。手元でも実行可）。
// 結果は3つに分ける：
//   危険（要対応）    … 証明書エラー・ページが無い・停止中・改ざんや不正な埋め込みの兆候・http や許可外への転送
//   要確認（人の目で） … 自動アクセスの拒否（403/429）・中身が空・時間切れ・別ドメインへの転送
//   合格               … 最終的な行き先まで開けて、上の兆候が無い
// 「要確認」は安全の確認ができていないという意味。危険が1件でもあれば終了コード1（通知が届く）。
// 要確認は、環境変数 FAIL_ON_REVIEW が "1" のときだけ失敗にする（"0" のときは警告として一覧に出すだけ。2026-11-19 運用者の判断待ちの変更：
// 自動アクセスを拒否するだけの公的サイトで毎週失敗し、本当に危ないリンクの通知が埋もれていたため）。
// 週替わりの分担（2026-11-19 追加）：全部で800件を超え、1回では時間の上限（40分）に収まらないおそれがあるため、4つのまとまりに分けて
// 1週に1つずつ調べる（4週で一巡）。LINK_GROUP=auto（既定）で週番号から決め、1〜4 で指定、all で全部（手動実行用）。
// 最後の取り込み（コミット）からの日数は結果の画面に書くだけ。45日を過ぎたときの知らせは scripts/check-keepalive.mjs が行う。
// 転送は最大5回まで実際にたどり、最終的な行き先のページも同じ基準で調べる。
// アクセスは1件ずつ、間隔をあけて行う（相手のサーバーに負担をかけない）。秘密情報は使わない。
// 対象：リンク集・都道府県の窓口リンク（どちらもサイトに表示しているものだけ）・手動掲載の原典とリンク・今日の動物たちの原典・説明ページなどの HTML 内のリンク。
//       自動取得の WHO・CISA・NVD の個別ページは、許可リストの公的機関のドメインで毎日作られるため対象外。
//       X（旧Twitter）は自動アクセスを受け付けないため対象外（各機関の公式サイトの掲載で確認する）。
import './lib/node-guard.mjs';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { emergencyUrls, readHealthChecks, humanDue, EMERGENCY_PAGE } from './lib/health-checks.mjs';
import { execFileSync } from 'node:child_process';
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
import { WB_INDICATORS } from './fetch-worldbank.mjs';

const started = Date.now();

// 調べる URL を集める（通信はしない）。表示していないリンク（確認の記録が無い・URL が一致しない・確認日が無い）は運用者の確認待ちなので集めない
// 週替わりの分担（4週で一巡）。どのまとまりかは、そのリンクが載っている場所で決める
export const LINK_GROUPS = {
  1: { ja: '国別・国際のリンク集（福祉・こころ・感染症・研究・ITセキュリティ・防災防犯）', en: 'Country and international directory' },
  2: { ja: '日本の都道府県・市区町村・社会福祉協議会の窓口', en: 'Japanese prefectures, municipalities and social welfare councils' },
  3: { ja: '手動掲載の原典とリンク・説明ページ・統計の出典', en: 'Curated sources, page links and statistics sources' },
  4: { ja: '今日の動物たちの原典', en: "Sources of today's animals" },
  5: { ja: '急な病気・けがのページ（毎月。自動の検査のあと、運用者が中身を確かめる）', en: 'Emergency care page (monthly, then checked by the operator)' },
};
export function groupOfWhere(where) {
  const head = String(where).split(' ')[0];
  if (/^JP-\d{2}$/.test(head)) return 2;
  if (head === 'animals') return 4;
  if (head === 'health') return 5;
  if (head === 'entries' || head === 'compare' || head === 'profile' || head.startsWith('site/')) return 3;
  return 1;
}
// 日本時間の日付から、ISO 8601 の週番号を出し、4つのまとまりのどれを調べるかを決める
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y0) / 86400000 + 1) / 7);
}
// 4週で一巡：基準の月曜（2025-12-29。ISO週の2026年第1週の初め）からの経過週で決める。
// ISO週番号を4で割る方法は、53週ある年の年越しで同じまとまりが2週続き、ほかのまとまりが5週空くため使わない
const ROTATION_BASE = Date.UTC(2025, 11, 29);
export function weeksSinceBase(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 3600000);
  const day = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
  return Math.floor((day - ROTATION_BASE) / (7 * 86400000));
}
export function groupForDate(now = new Date()) {
  return (((weeksSinceBase(now) % 4) + 4) % 4) + 1;
}
// 急な病気・けがのページ（まとまり5）は、毎月最初の週（日本時間の1〜7日）の定時の実行で、今週の分に加えて調べる
export function isMonthlyWeek(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).getUTCDate() <= 7;
}
// LINK_GROUP の値を読む（auto・1〜4・all のどれか。それ以外は auto と同じに扱う）
export function selectGroups(value, now = new Date()) {
  const v = String(value || 'auto').trim();
  if (v === 'all') return [1, 2, 3, 4, 5];
  if (/^[1-5]$/.test(v)) return [Number(v)];
  return isMonthlyWeek(now) ? [groupForDate(now), 5] : [groupForDate(now)];
}
// 日本国内のリンクか（運用者がブラウザで確かめる一覧を分けて出すため）
export function isJapanese(url, where) {
  const head = String(where).split(' ')[0];
  if (head === 'JPN' || /^JP-\d{2}$/.test(head)) return true;
  try {
    return /\.jp$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function collectUrls() {
  const urls = new Map();
  const add = (url, where) => typeof url === 'string' && url.startsWith('https://') && !/^https:\/\/(x|twitter)\.com\//.test(url) && (urls.has(url) || urls.set(url, where));
  // 急な病気・けがのページ（まとまり5。毎月）を最初に集める（同じURLがほかにあっても、毎月の人の確認の対象にする）
  for (const [u, where] of emergencyUrls()) add(u, where);
  const dir = readData('data/directory/links.json');
  const ev = readData('data/directory/evidence.json').links;
  const isShown = (l) => isShownLink(l, ev);
  for (const [cid, block] of Object.entries(dir.countries)) for (const links of Object.values(block)) for (const l of links) if (isShown(l)) add(l.url, `${cid} ${l.id}`);
  for (const links of Object.values(dir.international)) for (const l of links) if (isShown(l)) add(l.url, `INTL ${l.id}`);
  // 日本の都道府県の福祉ページ（福祉の探し方ページで表示するもの）
  // 市区町村・社会福祉協議会の相談ページ（local。2026-11 追加）も、表示するものはすべて調べる（独立監査の指摘）
  for (const p of readData('data/directory/prefectures.json').prefectures)
    for (const l of [...(p.links || []), ...(p.local || [])]) if (isShown(l)) add(l.url, `JP-${p.code} ${l.id}`);
  for (const it of readData('data/curated/entries.json').items) {
    add(it.source.url, `entries ${it.id}`);
    for (const l of it.links || []) add(l.url, `entries ${it.id}`);
  }
  for (const f of readData('data/curated/animals.json').facts) add(f.source.url, `animals ${f.id}`);
  // 「世界をくらべる」の指標の出典（世界銀行の指標のページ）。画面の JS が組み立てるリンクのうち、出典として表示するもの
  // 対象外：自動取得の情報のリンク（取得のたびに変わる。取得時に許可リストで検査）、X（公式アカウント。取得の仕組みが無いため、運用者が月1回確認）
  for (const ind of WB_INDICATORS) add(ind.source.url, `compare ${ind.key}`);
  // 国の基本情報（国の欄で JS が組み立てるリンク）：外務省の基礎データ・政府観光局・その国の世界遺産（ユネスコ）。2026-11-24 追加
  {
    let cp = { countries: {} };
    try {
      cp = readData('data/curated/country-profiles.json');
    } catch {
      /* ファイルが無い版では調べない */
    }
    for (const [cid, c] of Object.entries(cp.countries || {})) {
      add(c.mofa?.url, `profile ${cid} mofa`);
      add(c.tourism?.url, `profile ${cid} tourism`);
      if (c.whc) add(`https://whc.unesco.org/en/statesparties/${c.whc}`, `profile ${cid} whc`);
    }
  }
  for (const name of readdirSync(resolve(CODE_ROOT, 'site')).filter((n) => n.endsWith('.html') && n !== EMERGENCY_PAGE)) {
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
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { /* 壊れた URL は、外部リンクの判定に使わない */ }
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
// AI への指示のような文（プロンプトインジェクション）。隠し文字・コメントに入れられることもあるため、HTML の生の文字でも調べる
// （2026-11 運用者の依頼：リンク先に変な指示があれば、従わずに報告し、そのリンクをこのサイトから外す）
const INJECTION = new RegExp(
  [
    'ignore\\s+(?:all\\s+|any\\s+)?(?:the\\s+)?(?:previous|prior|above|earlier)\\s+(?:instructions|prompts|rules)',
    'disregard\\s+(?:all\\s+|the\\s+)?(?:previous|prior|above)\\s+(?:instructions|prompts)',
    '(?:^|\\W)(?:system\\s+prompt|developer\\s+message)(?:\\W|$)',
    '(?:if\\s+you\\s+are|attention|note\\s+to)\\s+(?:an?\\s+)?(?:ai|llm|language\\s+model|assistant|chatbot)\\b',
    '<\\|im_start\\|>|\\[INST\\]',
    '(?:以前|これまで|上記|前)の(?:指示|命令|プロンプト)を(?:無視|忘れ)',
    '(?:AI|ＡＩ|人工知能|アシスタント)(?:の方|の皆様)?(?:は|へ|に)(?:次|以下)の(?:指示|命令|手順)',
  ].join('|'),
  'i',
);
export function looksLikeInjection(html) {
  return INJECTION.test(String(html).replace(/\s+/g, ' '));
}
export function judgeContent(html, pageUrl) {
  if (looksLikeInjection(html)) return 'injection';
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
    if (sign === 'injection') return ['danger', 'AI への指示のような文（プロンプトインジェクションの疑い。従わずに報告し、リンクを外す）' + (crossDomain ? `（転送先 ${crossDomain}）` : '')];
    if (sign === 'spam') return ['danger', '改ざん・不正な埋め込みの疑い' + (crossDomain ? `（転送先 ${crossDomain}）` : '')];
    if (sign === 'parked') return ['danger', 'メンテナンス中・停止の疑い' + (crossDomain ? `（転送先 ${crossDomain}）` : '')];
    if (visibleLength(text) < 200) return ['review', '中身がほとんど空（JavaScript でしか表示されない、または停止の可能性）'];
    // 別ドメインへの転送は、行き先が問題なくても「要確認」（掲載URLを新しい公式URLに直すべきか人が判断する）
    if (crossDomain) return ['review', `別ドメインへ転送（${crossDomain}）。正しい公式の移転なら掲載URLを書き換える`];
    return ['ok', hop ? `同じサイト内で${hop}回転送` : ''];
  }
  return ['danger', '転送が多すぎる'];
}

// 最後のコミットからの日数（git が使えないときは null。そのときは知らせない）
export function daysSinceLastCommit(nowMs = Date.now()) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: CODE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const sec = Number(out);
    return Number.isFinite(sec) && sec > 0 ? Math.floor((nowMs - sec * 1000) / 86400000) : null;
  } catch {
    return null;
  }
}
export const KEEPALIVE_DAYS = 45;

async function run() {
  const all = collectUrls();
  const ev = all.ev;
  const groups = selectGroups(process.env.LINK_GROUP);
  const urls = new Map([...all.urls].filter(([, where]) => groups.includes(groupOfWhere(where))));
  const failOnReview = process.env.FAIL_ON_REVIEW === '1';
  const idle = daysSinceLastCommit();
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

const urlOf = (line) => (line.match(/（(https:\/\/[^（）\s]+)）$/) || [])[1] || '';
const whereOf = (line) => line.split(':')[0];
const reviewJp = review.filter((p) => isJapanese(urlOf(p), whereOf(p)));
const reviewAbroad = review.filter((p) => !reviewJp.includes(p));
const nextGroup = (groupForDate(new Date(Date.now() + 7 * 86400000)));
// 急な病気・けがのページ：人の確認が必要なリンクは、自動の検査の結果（危険・要確認）とは別に、毎週数える（通信はしない）
const healthUrls = new Map([...all.urls].filter(([, w]) => groupOfWhere(w) === 5));
const due = humanDue(healthUrls, readHealthChecks());
const autoFlag = (u) => (danger.some((l) => urlOf(l) === u) ? '自動の検査：危険' : review.some((l) => urlOf(l) === u) ? '自動の検査：要確認' : groups.includes(5) ? '自動の検査：通過' : '自動の検査：今週は対象外');
const report = [
  `# リンクの安全確認（今回：${groups.map((g) => `${g}. ${LINK_GROUPS[g].ja}`).join('／')}・${urls.size}件／全体 ${all.urls.size}件）`,
  `合格 ${ok}件／危険 ${danger.length}件／要確認 ${review.length}件（うち日本国内 ${reviewJp.length}件）／既知（ブラウザで確認済み・自動アクセスのみ拒否）${known.length}件${skipped ? `／時間切れで未確認 ${skipped}件` : ''}`,
  `次回（来週の自動実行）：${nextGroup}. ${LINK_GROUPS[nextGroup].ja}。全部を一度に調べるときは、手動実行で group に all を選ぶ`,
  idle === null ? '最後の取り込みからの日数：確認できなかった' : `最後の取り込み（コミット）から ${idle} 日${idle >= KEEPALIVE_DAYS ? `（${KEEPALIVE_DAYS}日を過ぎた。60日で GitHub が定時実行を止めるため、何か1件取り込んでください）` : ''}`,
  '',
  `## 急な病気・けがのページ：運用者が中身を確かめるリンク（${due.length}件。自動の検査の結果とは別に数える）`,
  `毎月最初の週は今月まだ確認していないものすべて、ほかの週は未確認・期限が近いものを出す。手順は ops/LINK-SAFETY.md の「急な病気・けがのページの月1回の確認」`,
  ...due.map((d) => `- ${d.where}: ${d.reason}／${autoFlag(d.url)}（${d.url}）`),
  ...(due.length ? [`確かめ終えたら node scripts/mark-health-checked.mjs <URL> … で記録し、取り込む（期限切れでもリンクは消さない。未確認のリンクだけ出さない）`] : []),
  '',
  `## 危険（要対応：掲載から外すか、公式の新しいURLに差し替える）`,
  ...danger.map((p) => `- ${p}`),
  '',
  `## 要確認・日本国内（運用者が自分のブラウザで開いて確かめる。開く前に下の「確かめ方」を読む）`,
  ...reviewJp.map((p) => `- ${p}`),
  '',
  `## 要確認・海外（同じく、確かめるまで新しく掲載しない。迷うものは載せない）`,
  ...reviewAbroad.map((p) => `- ${p}`),
  '',
  `## 確かめ方（要確認）`,
  `- 一覧の URL を手で打たず、このサイトの該当ページ（福祉の相談先・地球儀の国のリンク集）から開く。アドレス欄のドメインが一覧と同じか、鍵のマークに警告が無いかを見る`,
  `- ダウンロードやログイン、個人情報の入力を求められたら、何も押さずに閉じる。問題なければ node scripts/mark-link-checked.mjs <URL> --blocked-ok で記録する（自動アクセスだけ拒否するサイト）`,
  '',
  `## 既知（失敗にしない。ブラウザで確認済みのサイトが自動アクセスだけを拒否している。月に1回はブラウザで開いて確かめる）`,
  ...known.map((p) => `- ${p}`),
].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.split('\n').map((l) => (l.startsWith('- ') ? `- ${mdSafe(l.slice(2))}` : l)).join('\n') + '\n');
if (!failOnReview) for (const p of review) console.log(`::warning::要確認 ${mdSafe(p).slice(0, 300)}`);
// 取り込み忘れ（45日）の知らせは、別のステップ（scripts/check-keepalive.mjs）で行う。ここでは結果の画面に日数を書くだけ
for (const d of due) console.log(`::error title=急な病気・けがのページ：人の確認が必要::${mdSafe(`${d.where} ${d.reason} ${d.url}`).slice(0, 300)}`);
process.exit(danger.length || (failOnReview && review.length) || skipped || due.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
