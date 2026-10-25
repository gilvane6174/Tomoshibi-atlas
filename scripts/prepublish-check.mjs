// GitHub に push する前（特に最初の公開の前）に、手元で一度に確認する。
// 公開リポジトリでは、push した瞬間に中身と履歴が誰でも読めるようになるため、CI より前にここで止める。
// 使い方: node scripts/prepublish-check.mjs     （すべて成功したら「公開前チェックOK」）
import { execFileSync } from 'node:child_process';
import './lib/node-guard.mjs';

const steps = [
  ['個人情報・秘密情報', ['scripts/check-privacy.mjs']],
  ['コミット履歴（全ブランチ・全件）の名前・メール・全ファイルの全版・メッセージ', ['scripts/check-history.mjs', '--strict']],
  ['リポジトリ設定・ワークフロー・同梱ライブラリ', ['scripts/check-repo.mjs']],
  ['自己テスト', ['scripts/test.mjs']],
  ['掲載データ', ['scripts/validate-data.mjs']],
  ['ネット接続なしの組み立て', ['scripts/build.mjs', '--offline']],
];
for (const [name, args] of steps) {
  process.stdout.write(`■ ${name} … `);
  try {
    execFileSync('node', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('OK');
  } catch (e) {
    console.log('失敗');
    console.error(String(e.stdout || '') + String(e.stderr || ''));
    process.exit(1);
  }
}
console.log('公開前チェックOK（ただし、これは機械で分かる範囲の確認です。差分は必ず自分の目でも確認してください）');
