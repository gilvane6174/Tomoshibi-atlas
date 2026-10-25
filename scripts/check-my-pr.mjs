// PR を出す前に、CI と同じ「範囲・量・日付・更新履歴」の検査を手元で行う（AI・bot 向け）。
// 前提：作業ブランチ（curated/…）で変更をコミット済みで、最新の main を取り込んでいること。
// 使い方: AI_LOGIN=<自分のGitHubユーザー名> node scripts/check-my-pr.mjs
import { execFileSync } from 'node:child_process';
import './lib/node-guard.mjs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
// コミットしていない変更・まだ git に登録していないファイルがあれば、先に知らせる（CI はコミット済みの内容だけを見るため）
const dirty = git('status', '--porcelain', '--untracked-files=all');
if (dirty) {
  console.error('コミットしていない変更、または未登録のファイルがあります。変更は2ファイルだけにして、コミットしてから実行してください:');
  console.error(dirty.split('\n').map((l) => '  ' + l).join('\n'));
  process.exit(1);
}
try {
  git('fetch', '--quiet', 'origin', 'main');
} catch {
  console.log('origin/main を取得できませんでした。手元の main と比べます');
}
const baseRef = (() => {
  try {
    return git('rev-parse', 'origin/main');
  } catch {
    return git('rev-parse', 'main');
  }
})();
const env = {
  ...process.env,
  PR_AUTHOR: process.env.AI_LOGIN || 'local-check',
  AI_ACCOUNT_LOGINS: process.env.AI_LOGIN || 'local-check',
  MAINTAINER_LOGIN: process.env.MAINTAINER_LOGIN || 'operator-not-set',
  BASE_SHA: git('merge-base', baseRef, 'HEAD'),
  HEAD_SHA: git('rev-parse', 'HEAD'),
  HEAD_REF: git('rev-parse', '--abbrev-ref', 'HEAD'),
  BASE_REF: 'main',
  PR_TITLE: process.env.PR_TITLE || '',
  PR_BODY: process.env.PR_BODY || '',
};
if (env.BASE_SHA !== baseRef) console.log('注意：最新の main を取り込んでいません。PR を出す前に main を取り込んでください（rebase または merge）');
execFileSync('node', [new URL('./check-pr-scope.mjs', import.meta.url).pathname], { env, stdio: 'inherit' });
