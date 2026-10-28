// 個人情報・秘密情報がリポジトリに紛れ込んでいないかを検査する（CIと、任意でコミット前に実行）。
// 見つかったら終了コード1。内容は表示せず、場所と種類だけを表示する。
// 例外（誤検知）は下の ALLOW に「ファイル＋種類」で登録する。ファイル内の書き込みで例外を作ることはできない。
// 使い方: node scripts/check-privacy.mjs   （TA_TARGET_ROOT を指定すると、そのフォルダを検査する）

import { readdirSync, lstatSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import { DATA_ROOT, readNoFollow } from './lib/safety.mjs';

// 検査しない場所（同梱ライブラリ・地図データは第三者の公開物で、巨大なため）
const SKIP_DIRS = new Set(['.git', 'node_modules', '_site']);
const SKIP_PATHS = new Set(['site/vendor', 'site/data/geo']);
// リポジトリに置いてはいけない種類のファイル（画像の位置情報・文書のメタデータから個人情報が漏れるため）
const BANNED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.mov', '.mp4']);
const TEXT_EXT = new Set(['.md', '.json', '.mjs', '.js', '.html', '.css', '.yml', '.yaml', '.txt', '.svg', '']);

// 誤検知の例外（運用者だけが変更できる）。[ファイル, 種類]
export const ALLOW = [['scripts/test.mjs', 'メールアドレス']];

// 検出パターン（パターン自体が引っかからないよう、一部の文字列を分割して組み立てている）
const at = '@';
export const RULES = [
  ['メールアドレス', new RegExp(`[A-Za-z0-9._%+-]+\\s?(${at}|\\[at\\]|\\(at\\)|\\sat\\s)\\s?[A-Za-z0-9-]+(\\.|\\s?\\[dot\\]\\s?|\\s?\\(dot\\)\\s?|\\sdot\\s)[A-Za-z0-9.-]*[A-Za-z]{2,}`, 'i')],
  ['電話番号らしき数字', /(?<![\d-])(\+81[\s-]?\(?0?\d{1,4}\)?[\s-]?\d{1,4}[\s-]?\d{3,4}|\(?0\d{1,4}\)?[\s-]\d{1,4}[\s-]\d{3,4}|0[5789]0\d{8}|0[1-9]\d{8})(?![\d-])/],
  ['郵便番号らしき数字', /〒\s?\d{3}-?\d{4}|(?<![\d-])\d{3}-\d{4}(?![\d-])/],
  ['住所らしき記述', /[^\s、。]{1,10}(市|区|町|村)[^\s、。]{0,12}\d+\s?(丁目|番地?|号|-\d+)/],
  ['GitHubトークン', new RegExp('gh' + '[pousr]_[A-Za-z0-9]{20,}|github' + '_pat_[A-Za-z0-9_]{20,}')],
  [
    // sk- は英単語の途中（risk-… など）を除く
    'APIキー・秘密鍵らしき文字列',
    new RegExp(
      ['(?<![A-Za-z0-9])sk-' + '[A-Za-z0-9_-]{20,}', 'sk_' + '(live|test)_[A-Za-z0-9]{10,}', 'AKIA' + '[0-9A-Z]{16}', 'AIza' + '[0-9A-Za-z_-]{30,}', 'glpat' + '-[A-Za-z0-9_-]{15,}', 'xox' + '[baprs]-[A-Za-z0-9-]{10,}', 'eyJ' + '[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}', '-----BEGIN [A-Z ]*PRIVATE ' + 'KEY-----'].join('|'),
    ),
  ],
  ['AIとの会話・作業のURL', new RegExp('(claude\\.ai|chatgpt\\.com|chat\\.openai\\.com|grok\\.com|x\\.com/i/grok|gemini\\.google\\.com|g\\.co/gemini|perplexity\\.ai|poe\\.com|copilot\\.microsoft\\.com|chat\\.deepseek\\.com|chat\\.mistral\\.ai)/[^\\s)"\']+', 'i')],
  ['AIのセッション情報', new RegExp('Claude' + '-Session:|session' + '_[0-9A-Za-z]{16,}', 'i')],
  ['PC内のユーザーフォルダ', /\/Users\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+|\/home\/(?!runner\b)[A-Za-z0-9._-]+\/|~\/(Documents|Desktop|Downloads|Library)\b|\\\\wsl\$/],
];

// PNG の中身が「画像そのもの」だけか（文字・撮影情報・位置情報などの付帯情報が無いか）を調べる
const PNG_OK_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'sRGB', 'gAMA', 'cHRM', 'pHYs']);
export function checkCleanPng(buf) {
  if (buf.length > 1_500_000) return '画像が大きすぎる（1.5MBまで）';
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'PNG ではない';
  // チャンクを1つずつ厳密にたどる：長さ・CRC が正しいこと、最初が IHDR、最後が IEND で、その後ろに余分なデータが無いこと
  let i = 8;
  let first = true;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    if (i + 12 + len > buf.length) return '画像の構造が壊れている（長さが不正）';
    const type = buf.toString('latin1', i + 4, i + 8);
    if (first && type !== 'IHDR') return '画像の構造が不正（IHDR で始まっていない）';
    first = false;
    if (!PNG_OK_CHUNKS.has(type)) return `画像に付帯情報（${type}）が含まれている。付帯情報の無い PNG に作り直す`;
    if (crc32(buf.subarray(i + 4, i + 8 + len)) !== buf.readUInt32BE(i + 8 + len)) return `画像の構造が壊れている（${type} の CRC が不一致）`;
    i += 12 + len;
    if (type === 'IEND') return i === buf.length ? null : '画像の後ろに余分なデータがある';
  }
  return '画像の構造が不正（IEND が無い）';
}

// 1行を検査して、当たった種類の一覧を返す（全角数字・全角記号もそろえてから検査する）
export function scanText(text) {
  const t = text.normalize('NFKC');
  return RULES.filter(([, re]) => re.test(t)).map(([label]) => label);
}

function walk(dir, findings) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(DATA_ROOT, full).split('\\').join('/');
    const st = lstatSync(full);
    if (st.isSymbolicLink()) {
      findings.push(`${rel}  シンボリックリンクは置かない`);
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name) && !SKIP_PATHS.has(rel)) walk(full, findings);
      continue;
    }
    const ext = extname(name).toLowerCase();
    // 例外：SNS共有用の画像1枚だけ。埋め込み情報（撮影情報・文字情報・位置情報など）の無いPNGであることを確かめる
    if (rel === 'site/og-image.png') {
      const why = checkCleanPng(readNoFollow(full, { expect: st }).buf);
      if (why) findings.push(`${rel}  ${why}`);
      continue;
    }
    if (BANNED_EXT.has(ext)) {
      findings.push(`${rel}  画像・PDF・文書ファイルは置かない（埋め込み情報から個人情報が漏れるため）`);
      continue;
    }
    // 開いたファイル自体の大きさで判断する（確かめた後に差し替えられても、読んだ中身と大きさが食い違わない）
    const { size, buf } = readNoFollow(full, { maxBytes: 2_000_000, expect: st });
    if (!buf) {
      // 大きなファイルは、確認済みの地図データ・同梱ライブラリだけを許可する（見逃しを作らない）
      if (size > 2_000_000 && !/^site\/(data\/geo|vendor)\//.test(rel)) findings.push(`${rel}  2MBを超えるファイルは置かない（検査できないため）`);
      continue;
    }
    if (!TEXT_EXT.has(ext) && buf.includes(0)) {
      findings.push(`${rel}  文字以外のファイルは置かない`);
      continue;
    }
    buf
      .toString('utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const label of scanText(line)) {
          if (ALLOW.some(([f, l]) => f === rel && l === label)) continue;
          findings.push(`${rel}:${i + 1}  ${label}`);
        }
      });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = [];
  walk(DATA_ROOT, findings);
  if (findings.length) {
    console.error(`個人情報・秘密情報の疑い: ${findings.length}件（内容は表示しません。該当箇所を確認してください）`);
    for (const f of findings) console.error(' - ' + f);
    process.exit(1);
  }
  console.log('privacy check OK');
}
