// 運用者が「急な病気・けがのとき」のページのリンク先を、自分のブラウザで開いて中身まで確かめたことを記録する。
// 記録は data/curated/health-checks.json。一度でも確認したリンクがサイトに表示される（期限切れでも消さない。月1回の確認は続ける）。
// 使い方: node scripts/mark-health-checked.mjs --list            … すべてのリンクと、最後に確認した日・状態を一覧にする
//         node scripts/mark-health-checked.mjs <URL> [<URL> ...]   … 確認できたURLを、今日の日付で記録する
// 確認の手順は ops/LINK-SAFETY.md の「急な病気・けがのページの月1回の確認」。AI・bot はこのスクリプトを使わない（人間の確認の代わりにはならない）。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_ROOT } from './lib/safety.mjs';
import { emergencyUrls, daysSinceCheck, HUMAN_CHECK_DAYS } from './lib/health-checks.mjs';

const path = resolve(DATA_ROOT, 'data/curated/health-checks.json');
const doc = JSON.parse(readFileSync(path, 'utf8'));
const urls = emergencyUrls();
const args = process.argv.slice(2);

if (!args.length || args[0] === '--list') {
  let due = 0;
  console.log(`急な病気・けがのページのリンク：${urls.size}件（一度でも確認したものが表示されます。期限は${HUMAN_CHECK_DAYS}日）`);
  for (const [url, where] of urls) {
    const n = daysSinceCheck(url, doc.checks);
    const state = n === null ? '未確認' : n > HUMAN_CHECK_DAYS ? `期限切れ（${n}日前）` : `確認済み（${n}日前）`;
    if (n === null || n > HUMAN_CHECK_DAYS - 7) due++;
    console.log(`- [${state}] ${url}  （${where}）`);
  }
  console.log(`今月確かめるもの（未確認・期限切れ・1週間以内に期限切れ）：${due}件`);
  process.exit(0);
}

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
let changed = 0;
for (const url of args) {
  if (!urls.has(url)) {
    console.error(`見つかりません（急な病気・けがのページのリンクではないURL）: ${url}`);
    process.exitCode = 1;
    continue;
  }
  doc.checks[url] = today;
  changed++;
}
if (changed) {
  doc.checks = Object.fromEntries(Object.entries(doc.checks).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  console.log(`${changed}件を記録しました（${today}）。次の組み立てから、リンクとして表示されます。`);
}
