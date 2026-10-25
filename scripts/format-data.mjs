// 掲載データ2ファイルを、CI が求める決まった書式（インデント2・\u エスケープなし・末尾改行）に整える。
// 内容は変えない（JSON として読めない場合は何もせずに終了コード1）。
// 使い方: node scripts/format-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_ROOT } from './lib/safety.mjs';

let failed = false;
for (const rel of ['data/curated/entries.json', 'data/curated/changelog.json']) {
  const file = resolve(DATA_ROOT, rel);
  try {
    const text = JSON.stringify(JSON.parse(readFileSync(file, 'utf8')), null, 2) + '\n';
    writeFileSync(file, text);
    console.log(`整形しました: ${rel}`);
  } catch (e) {
    console.error(`${rel}: JSON として読めません（${e.message}）`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
