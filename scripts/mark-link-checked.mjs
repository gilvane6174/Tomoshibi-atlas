// 運用者が、リンク集のリンクを自分のブラウザで開いて確認したことを記録する（data/directory/evidence.json）。
// 記録したリンクは、次の組み立てからサイトに表示される。確認の基準は ops/LINK-SAFETY.md の「載せてよいリンクの条件」。
// 使い方: node scripts/mark-link-checked.mjs <URL> [<URL> ...]      … 確認できたURLを記録する
//         node scripts/mark-link-checked.mjs --list                   … まだ表示されていない（確認が必要な）URLを一覧にする
//         node scripts/mark-link-checked.mjs --blocked-ok <URL> ...    … ブラウザでは問題なく開けるが、自動アクセスだけを拒否するサイトとして記録する
//                                                                        （週1回のリンク確認で、拒否・空のときに失敗にせず「既知」として出す）
// AI・bot はこのスクリプトを使わない（運用者の確認の代わりにはならない）。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_ROOT } from './lib/safety.mjs';

const path = resolve(DATA_ROOT, 'data/directory/evidence.json');
const doc = JSON.parse(readFileSync(path, 'utf8'));
const blockedOk = process.argv.includes('--blocked-ok');
const args = process.argv.slice(2).filter((a) => a !== '--blocked-ok');
const SHOW = new Set(['fetched', 'operator']);

if (!args.length || args[0] === '--list') {
  if (blockedOk) {
    console.error('--blocked-ok にはURLを指定してください');
    process.exit(1);
  }
  const pending = new Map();
  for (const [id, e] of Object.entries(doc.links)) if (!SHOW.has(e.method)) pending.set(e.url, [...(pending.get(e.url) || []), id]);
  console.log(`確認が必要なURL：${pending.size}件（確認できるまでサイトには表示されません）`);
  for (const [url, ids] of pending) console.log(`- ${url}  （${ids.join(', ')}）`);
  process.exit(0);
}

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
let changed = 0;
for (const url of args) {
  const hits = Object.values(doc.links).filter((e) => e.url === url);
  if (!hits.length) {
    console.error(`見つかりません（リンク集にないURL）: ${url}`);
    process.exitCode = 1;
    continue;
  }
  for (const e of hits) {
    Object.assign(e, { checkedAt: today, method: 'operator', how: '運用者がブラウザで開いて確認', evidence: '' });
    if (blockedOk) e.autoCheck = 'blocked-ok';
    changed++;
  }
}
if (changed) writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
console.log(`${changed}件を「運用者が確認（${today}）」として記録しました`);
