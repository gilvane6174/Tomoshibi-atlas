// 公開する直前の組み立て結果（_site）を検査する。見つかったら終了コード1（公開しない）。内容は表示せず、場所と種類だけを表示する。
// 1. 手元の確認版だけの仕組み（見本のデータ・まとめた確認用のプログラム・運用者用のメモ）が混ざっていないか
// 2. 個人情報・秘密情報（メールアドレス・トークン・AIとの会話のURL・PC内のフォルダ名など）が紛れ込んでいないか
// 3. .env・鍵ファイルなど、公開してはいけない種類のファイルが入っていないか
//    （電話番号・住所の形は、公的機関の公開の相談番号などを載せるため、ここでは見ない。リポジトリ側は check-privacy.mjs が見る）
// 使い方: node scripts/build.mjs のあとに node scripts/check-output.mjs（TA_OUTPUT_DIR で検査するフォルダを変えられる）

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RULES } from './check-privacy.mjs';

const TEXT_EXT = new Set(['.html', '.json', '.js', '.css', '.xml', '.txt', '.svg', '.md', '']);
// 確認版だけの目印（ファイル名・文字列）。公開物に入っていたら止める
const PREVIEW_FILES = [/^js\/bundle-/, /^js\/preview-data\.js$/, /operator-checklist/i, /not-for-github/i, /^0-README/];
const PREVIEW_MARKS = ['__PREVIEW_DATA', '__taLangLoaded', '【見本】', 'not-for-github', 'operator-checklist'];
// 公開してはいけない種類のファイル（設定・鍵・Git の中身など）。名前だけで止める
const SECRET_FILES = /(^|\/)\.(env|git|npmrc|ssh|aws)(\/|\.|$)|(^|\/)(id_rsa|id_ed25519)|\.(pem|key|p12|pfx)$/i;
const SKIP_RULES = new Set(['電話番号らしき数字', '郵便番号らしき数字', '住所らしき記述']);
const SKIP_PATHS = [/^data\/geo\//, /^vendor\//];

export function checkOutput(root) {
  const findings = [];
  const walk = (dir) => {
    // 種類（リンク・フォルダ・ファイル）は一覧を読んだときの情報で判定する（調べてから開くまでの間に差し替えられる隙を作らない）
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const name = ent.name;
      const full = join(dir, name);
      const rel = relative(root, full).split('\\').join('/');
      if (ent.isSymbolicLink()) {
        findings.push(`${rel}  シンボリックリンク`);
        continue;
      }
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (PREVIEW_FILES.some((re) => re.test(rel))) findings.push(`${rel}  確認版だけのファイル`);
      if (SECRET_FILES.test(rel)) findings.push(`${rel}  公開してはいけない種類のファイル`);
      if (!TEXT_EXT.has(extname(name).toLowerCase()) || SKIP_PATHS.some((re) => re.test(rel))) continue;
      const text = readFileSync(full, 'utf8');
      for (const m of PREVIEW_MARKS) if (text.includes(m)) findings.push(`${rel}  確認版だけの目印`);
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].normalize('NFKC');
        for (const [label, re] of RULES) if (!SKIP_RULES.has(label) && re.test(t)) findings.push(`${rel}:${i + 1}  ${label}`);
      }
    }
  };
  walk(root);
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const root = resolve(process.env.TA_OUTPUT_DIR || '_site');
  const findings = checkOutput(root);
  if (findings.length) {
    console.error('公開物の検査で止めました（内容は表示しません）：');
    for (const f of findings.slice(0, 50)) console.error('  ' + f);
    process.exit(1);
  }
  console.log('output check OK');
}
