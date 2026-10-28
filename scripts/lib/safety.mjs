// 外部データとAI・人の手で編集されたデータを、画面に出す前に検査・整形する共通処理。
// 方針：怪しいものは「直して通す」のではなく「落とす」。迷ったら表示しない。

import './node-guard.mjs'; // 修正前の脆弱性がある Node.js では動かさない
import { readFileSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// CODE_ROOT：このスクリプト自身がある場所（設定・許可リスト・地図索引はここから読む）
// DATA_ROOT：検査・組み立ての対象（通常は同じ場所。PR検査では、信頼できる main 側のスクリプトで PR 側のデータを検査する）
export const CODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_ROOT = process.env.TA_TARGET_ROOT ? resolve(process.env.TA_TARGET_ROOT) : CODE_ROOT;
export const ROOT = DATA_ROOT;

export const readCode = (rel) => JSON.parse(readFileSync(resolve(CODE_ROOT, rel), 'utf8'));
// データファイルはシンボリックリンクを拒否する（別ファイルにすり替える攻撃の防止）
export function readData(rel) {
  const p = resolve(DATA_ROOT, rel);
  if (lstatSync(p).isSymbolicLink()) throw new Error(`${rel} はシンボリックリンクのため読み込みません`);
  return JSON.parse(readFileSync(p, 'utf8'));
}
export const readJson = readCode;

const SOURCES = readCode('scripts/allowed-sources.json');

// 表示偽装に使われる文字：制御文字(Cc)・書式文字(Cf：ゼロ幅・双方向制御・タグ文字等)・私用領域(Co)・未割り当て(Cn)・孤立サロゲート(Cs)、
// ハングルの空白に見える文字、点字の空白、行・段落区切り、結合書記素結合子、異体字セレクタ
const INVISIBLE_SRC = '[\\p{Cc}\\p{Cf}\\p{Co}\\p{Cn}\\p{Cs}\\u115F\\u1160\\u3164\\uFFA0\\u2800\\u2028\\u2029\\u034F\\uFE00-\\uFE0F\\u{E0100}-\\u{E01EF}]';
const INVISIBLE_G = new RegExp(INVISIBLE_SRC, 'gu');
const INVISIBLE_1 = new RegExp(INVISIBLE_SRC, 'u');
export const hasInvisible = (s) => INVISIBLE_1.test(s);

// ラテン文字とキリル・ギリシャ文字が1語に混ざっている（例：キリル文字の с で cure を偽装）
export const hasMixedScript = (s) => s.split(/[^\p{L}]+/u).some((w) => /\p{Script=Latin}/u.test(w) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(w));

// 取得データ用：偽装文字を空白に置き換え、空白を詰め、長さを制限する
export function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const t = value.replace(INVISIBLE_G, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...t]; // 絵文字などを途中で切らないよう、文字単位で数える
  return chars.length > maxLength ? chars.slice(0, maxLength - 1).join('') + '…' : t;
}

// 語句検査用：全角半角をそろえ（NFKC）、偽装文字を除き、小文字にする
export const normalizeForMatch = (s) => s.normalize('NFKC').replace(INVISIBLE_G, '').replace(/\s+/g, '').toLowerCase();
const normalizeKeepSpaces = (s) => s.normalize('NFKC').replace(INVISIBLE_G, '').replace(/\s+/g, ' ').toLowerCase();

// 断定・誇大・優劣表現の検出（日本語は部分一致、英語は単語境界つきの正規表現）。
// これは仕掛け線であり、最終確認は運用者のレビュー。
const JA = SOURCES.forbiddenPhrases.map(normalizeForMatch);
const EN = SOURCES.forbiddenPatternsEn.map((p) => new RegExp(p, 'iu'));
export function findForbidden(text) {
  const hits = [];
  const n = normalizeForMatch(text);
  for (const w of JA) if (n.includes(w)) hits.push(w);
  const e = normalizeKeepSpaces(text);
  for (const re of EN) if (re.test(e)) hits.push(re.source);
  return hits;
}

// 悪用防止：攻撃に直接使える情報（攻撃手順・攻撃コード・侵害の痕跡情報など）の混入を検出する。
// このサイトは「何に気をつけ、どこで公式の対処法を確認するか」までを載せ、攻撃のやり方は載せない。
const ATTACK_PATTERNS = [
  ['IPアドレス', /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  ['IPv6アドレス', /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/i],
  ['ハッシュ値（侵害の痕跡情報）', /\b[0-9a-f]{32}\b|\b[0-9a-f]{40}\b|\b[0-9a-f]{64}\b/i],
  ['コマンド・コード', /(`{3}|\bcurl\s+-|\bwget\s+http|powershell\s+-|\bcmd(?:\.exe)?\s+\/c\b|\/bin\/(?:ba)?sh\b|chmod\s+\+x|base64\s+-d|\beval\s*\(|<script|\bnc\s+-[el])/i],
  ['攻撃コード・攻撃手順（英語）', /\b(?:proof[-\s]of[-\s]concept|poc\b|exploit\s*(?:code|kit|script)|exploits?\s+(?:(?:is|are|was|were)\s+)?(?:available|published|released)|working\s+exploit|weaponi[sz]ed|reverse\s+shell|payload|shellcode|step[-\s]by[-\s]step\s+(?:attack|exploit)|how\s+to\s+(?:exploit|hack|bypass))/i],
  ['攻撃コード・攻撃手順（日本語）', /(攻撃コード|攻撃の?手順|攻撃方法の詳細|攻撃のやり方|侵入の?手順|侵入方法|悪用の?手順|悪用方法|悪用の(?:やり方|仕方)|エクスプロイト|実証コード|検証コード|ペイロード|リバースシェル|シェルコード)/],
  ['未公開・未修正の脆弱性', /(未公開の脆弱性|未修正の脆弱性|修正前の脆弱性|ゼロデイの詳細|\bunpatched\s+(?:vulnerab|flaw)|\bnot\s+yet\s+(?:patched|disclosed))/i],
];
export function findAttackDetail(text) {
  // 「1[.]2[.]3[.]4」「hxxp://」のような無害化表記も元に戻してから調べる
  const n = text
    .normalize('NFKC')
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]/gi, '.')
    .replace(/\bhxxp/gi, 'http')
    .replace(/(?<=[0-9a-f])\s(?=[0-9a-f]{8})/gi, '');
  return ATTACK_PATTERNS.filter(([, re]) => re.test(n)).map(([label]) => label);
}

// HTMLタグらしきものが含まれていれば true（取得データでは除去、手動データでは拒否に使う）
export const looksLikeHtml = (s) => /<\s*\/?\s*[a-zA-Z!][^>]*>/.test(s);
export const stripTags = (s) => s.replace(/<[^>]*>/g, ' ');

// 許可リストに一致し、https で、認証情報・ポート指定の無いURLだけ通す。
// 各エントリ：host（必須）、subdomains（true ならサブドメインも許可）、path（パスの正規表現、任意）
// strict：手動データ用。検索パラメータ（?…）や # を含むURLも拒否する
function hostRuleMatches(rule, u) {
  const hostOk = u.hostname === rule.host || (rule.subdomains && u.hostname.endsWith('.' + rule.host));
  if (!hostOk) return false;
  return rule.path ? new RegExp(rule.path).test(u.pathname) : true;
}
export function isAllowedUrl(url, { strict = false } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  if (strict && (u.search || u.hash || url.includes('?') || url.includes('#'))) return false;
  return SOURCES.linkHosts.some((rule) => hostRuleMatches(rule, u));
}

// 国・分野別の相談先リンク集用：https・検索パラメータなし・directoryHosts に一致するURLだけ通す
export function isDirectoryUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || url.includes('?') || url.includes('#')) return false;
  return SOURCES.directoryHosts.some((rule) => hostRuleMatches(rule, u));
}

// 存在する日付か（2026-02-30 のような日付を拒否）、未来日でないか
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
// 「今日の動物たち」の原典用：https・検索パラメータなし・animalHosts に一致するURLだけ通す
export function isAnimalUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || url.includes('?') || url.includes('#')) return false;
  return (SOURCES.animalHosts || []).some((rule) => hostRuleMatches(rule, u));
}

export function isValidDate(s, { allowFutureDays = 1 } = {}) {
  if (typeof s !== 'string') return false;
  const m = s.match(ISO_DATE);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const cal = new Date(Date.UTC(y, mo - 1, d));
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) return false;
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return false;
  if (t.getTime() > Date.now() + allowFutureDays * 86400000) return false;
  return y >= 2000;
}

// 日本時間の今日（YYYY-MM-DD）
export const todayJst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
// 手動データ用：日本時間の今日より後の日付を拒否
export const notFutureJst = (s) => typeof s === 'string' && s.slice(0, 10) <= todayJst();

export const toIsoDate = (s) => new Date(s).toISOString();

// 「AI」の呼び方の変化への対応：米国政府は2026年9月の大統領令で、公式文書の「AI（artificial intelligence）」を
// 「SI（Super Intelligence）」と呼び替えるよう指示した。SI と書かれた AI 関連の情報も、AI の情報として扱う。
// ただし「SI」だけでは国際単位系・システムインテグレーター・国コード（スロベニア）などと区別できないため、
// 同じ文の中に「Super Intelligence／スーパーインテリジェンス／AI」の説明があるときだけ AI 関連とみなす（推測で決めない）。
export const SUPER_INTELLIGENCE = /super[\s-]*intelligence|スーパー[・\s]*インテリジェンス/i;
export const BARE_SI = /(^|[^A-Za-z0-9-])SI(?![A-Za-z0-9-])/; // SI-CERT のような固有名は除く
// 全角の「ＳＩ」なども同じに扱う（NFKC で正規化してから調べる）
export const siWithoutExplanation = (raw) => {
  const text = raw.normalize('NFKC');
  return BARE_SI.test(text) && !SUPER_INTELLIGENCE.test(text) && !/(^|[^A-Za-z])AI(?![A-Za-z])|人工知能/.test(text);
};
export const mentionsSuperIntelligence = (text) => SUPER_INTELLIGENCE.test(text.normalize('NFKC'));
