#!/usr/bin/env node
// 取り込み忘れの確認（週1回のリンク確認のワークフローの中で動かす。2026-11 追加）
// GitHub は、公開リポジトリで60日間コミットが無いと、定時実行（自動の更新・リンク確認）を止める。
// 45日を過ぎたら、このステップを失敗にする（メールが届くかは GitHub の通知の設定による。docs/OPERATIONS.md）。
// これは補助の知らせ。GitHub の決まりは「公開リポジトリで60日間活動が無いと定時実行を止める」で、定時実行そのものが遅れたり実行されなかったりすることもある。
// このワークフロー自体が止まれば知らせも届かないため、運用者は月に1回、Actions の画面で最近の実行があるかも見る。
// 日付を確かめられないときも、異常として失敗にする（黙って成功にしない）。
// 外部への通信はしない。リポジトリへは書き込まない。
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const KEEPALIVE_DAYS = 45;
export const STOP_DAYS = 60;

export function keepaliveMessage(days) {
  if (days === null) return { ok: false, text: '【確認が必要】最後の取り込みの日付を確かめられませんでした。GitHub のリポジトリの画面で、最後のコミットの日付を見てください（45日を過ぎていたら、何か1件取り込んでください）。' };
  const left = STOP_DAYS - days;
  if (days < KEEPALIVE_DAYS) return { ok: true, text: `最後の取り込みから ${days} 日。問題ありません（${KEEPALIVE_DAYS} 日を過ぎたら知らせます）` };
  return {
    ok: false,
    text: `【対応が必要】最後の取り込みから ${days} 日たちました。あと ${Math.max(left, 0)} 日で GitHub が自動の更新とリンク確認を止めます。GitHub で何か1件取り込んでください（掲載の追加や README の小さな修正でかまいません）。`,
  };
}

function lastCommitDays(nowMs = Date.now()) {
  try {
    const sec = Number(execFileSync('git', ['log', '-1', '--format=%ct'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    return Number.isFinite(sec) && sec > 0 ? Math.floor((nowMs - sec * 1000) / 86400000) : null;
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const m = keepaliveMessage(lastCommitDays());
  console.log(m.text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 取り込み忘れの確認\n${m.text}\n`);
  if (!m.ok) {
    console.log(`::error title=取り込みが必要（60日で自動更新が止まります）::${m.text}`);
    process.exit(1);
  }
}
