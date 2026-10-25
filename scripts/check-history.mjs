// 公開前に、main の最近のコミットの作者・コミッターに個人情報が入っていないかを確認する（公開ワークフローで実行）。
// GitHub がマージ時に作るコミットには、運用者の GitHub プロフィールの「Name」が入るため、
// そこに本名などを設定していると公開されてしまう。見つかったら公開を止めて知らせる。
// 使い方: MAINTAINER_LOGIN=... AI_ACCOUNT_LOGINS=a,b node scripts/check-history.mjs [--strict]
//   最初の push の前に、手元で --strict をつけて実行すること（問題があれば終了コード1）
import { execFileSync } from 'node:child_process';
import './lib/node-guard.mjs';
import { scanText, ALLOW, checkCleanPng } from './check-privacy.mjs';

const env = process.env;
// 運用者のユーザー名は CODEOWNERS からも読む（変数を設定する前の最初の公開でも誤検知しないように）
import { readFileSync } from 'node:fs';
const owner = (readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8').match(/^\*\s+@([A-Za-z0-9-]+)/m) || [])[1];
const NAMES = new Set(['GitHub', 'dependabot[bot]', 'github-actions[bot]', '吉岡有隆', 'Yutaka Yoshioka', owner, env.MAINTAINER_LOGIN, ...(env.AI_ACCOUNT_LOGINS || '').split(',').map((s) => s.trim())].filter(Boolean));
const NOREPLY = /(@users\.noreply\.github\.com|^noreply@github\.com)$/i;
let out;
try {
  // --strict（公開前に手元で実行）：全履歴を調べ、問題があれば失敗
  // 通常（公開ワークフロー）：直近7日のコミットを調べ、問題があれば失敗（古い履歴は警告のみ）
  // --all：すべてのブランチ・タグ（公開されうる参照）を対象にする
  const range = process.argv.includes('--strict') ? ['--all'] : ['--all', '--since=7.days'];
  out = execFileSync('git', ['log', ...range, '--format=%H%x00%an%x00%ae%x00%cn%x00%ce'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  console.error('git の履歴を読めませんでした（リポジトリの中で実行してください）');
  process.exit(1);
}
const bad = [];
for (const line of out.split('\n').filter(Boolean)) {
  const [sha, an, ae, cn, ce] = line.split('\x00');
  if (!NOREPLY.test(ae) || !NOREPLY.test(ce)) bad.push(`${sha.slice(0, 7)}: メールアドレスが noreply ではありません`);
  if (!NAMES.has(an) || !NAMES.has(cn)) bad.push(`${sha.slice(0, 7)}: 作者・コミッター名が許可された名前（GitHub ユーザー名・筆名）ではありません`);
}
// --strict のときは、すべての参照から届く「保存されたファイルの中身（blob）」を1つ残らず個人情報・秘密情報の検査にかける。
// 差分ではなく中身そのものを見るため、マージの解決時だけに入れて後で消したもの・コミットメッセージ以外のあらゆる版も対象になる。
// コミットメッセージも検査する。内容は表示しない。
// 公開ワークフロー（通常）でも、直近7日のコミットメッセージに AI との会話の URL・セッション情報・個人情報が無いかを調べる
if (!process.argv.includes('--strict')) {
  let recentMsgs = '';
  try {
    recentMsgs = execFileSync('git', ['log', '--all', '--since=7.days', '--format=%x01%H%n%B'], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    console.error('git のコミットメッセージを読めませんでした');
    process.exit(1);
  }
  let sha = '';
  for (const line of recentMsgs.split('\n')) {
    if (line.startsWith('\x01')) sha = line.slice(1, 8);
    else for (const label of scanText(line)) bad.push(`${sha}: コミットメッセージに「${label}」の疑い`);
  }
}
if (process.argv.includes('--strict')) {
  const opts = { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'ignore'] };
  let objects = '';
  let messages = '';
  try {
    objects = execFileSync('git', ['rev-list', '--all', '--objects'], opts);
    messages = execFileSync('git', ['log', '--all', '--format=%x01%H%n%B'], opts);
  } catch {
    console.error('git の履歴の中身を読めませんでした');
    process.exit(1);
  }
  const paths = new Map();
  for (const line of objects.split('\n').filter(Boolean)) {
    const [sha, ...rest] = line.split(' ');
    if (rest.length) paths.set(sha, [...(paths.get(sha) || []), rest.join(' ')]);
  }
  // 名前つきの object のうち blob だけを、cat-file --batch でまとめて読む
  const shas = [...paths.keys()];
  const types = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { ...opts, input: shas.join('\n') + '\n' });
  const blobs = types.split('\n').filter((l) => / blob /.test(l)).map((l) => l.split(' ')[0]);
  for (const sha of blobs) {
    const files = paths.get(sha).filter((f) => !/^site\/(vendor|data\/geo)\//.test(f));
    if (!files.length) continue;
    const buf = execFileSync('git', ['cat-file', 'blob', sha], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
    if (buf.includes(0)) {
      if (!files.every((f) => f === 'site/og-image.png')) bad.push(`${sha.slice(0, 7)} ${files[0]}: 文字以外のファイルが履歴にある`);
      else {
        // 共有画像は、過去のすべての版も付帯情報（文字・撮影情報・位置情報など）が無いことを確かめる
        const why = checkCleanPng(buf);
        if (why) bad.push(`${sha.slice(0, 7)} ${files[0]}: 過去の版の画像に問題（${why}）`);
      }
      continue;
    }
    for (const line of buf.toString('utf8').split('\n'))
      for (const label of scanText(line))
        if (!files.every((f) => ALLOW.some(([af, l]) => af === f && l === label))) bad.push(`${sha.slice(0, 7)} ${files[0]}: 履歴の中に「${label}」の疑い`);
  }
  let sha = '';
  for (const line of messages.split('\n')) {
    if (line.startsWith('\x01')) sha = line.slice(1, 8);
    else for (const label of scanText(line)) bad.push(`${sha}: コミットメッセージに「${label}」の疑い`);
  }
}
// 公開前の確認は、最初の push の前に手元で `node scripts/check-history.mjs --strict` を実行して行う（全履歴）。
// 公開ワークフローでは直近7日分を調べ、問題があれば公開を止めて運用者に知らせる。
if (bad.length) {
  for (const b of bad) console.error(`${process.env.GITHUB_ACTIONS ? '::error::' : ' - '}コミット履歴に個人情報の疑い（内容は表示しません）: ${b}`);
  console.error('docs/GITHUB-SETTINGS.md の「プロフィールの Name」の設定を確認してください');
  process.exit(1);
}
console.log('history check OK');
