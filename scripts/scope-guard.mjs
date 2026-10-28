// PR で変更されたファイルの一覧だけを見て、AI・bot・外部の PR が決められた範囲の外を変えていないかを調べる。
// .github/workflows/scope-guard.yml（pull_request_target）から、main 側のこのスクリプトで実行する。
// PR のコードは取り出さず、実行もしない（GitHub の API でファイル名と変更の種類だけを読む）。
// そのため、PR の中でワークフローや検査プログラムを書き換えても、この検査はすり抜けられない。
//
// 判定：
//   - 運用者の PR … 制限なし。運用者の PR と認めるのは、作成者が MAINTAINER_LOGIN・同じリポジトリのブランチ・curated/ 以外のブランチで、
//     かつ GitHub App を通さずに作られたと API で確かめられたときだけ（scripts/lib/owner-pr.mjs。確かめられなければ制限する）
//   - Dependabot の PR … .github/workflows/ の既存ファイルの変更だけ
//   - それ以外（AI・bot・外部の人）… data/curated/entries.json と data/curated/changelog.json の変更だけ
import './lib/node-guard.mjs';
import { pathToFileURL } from 'node:url';
import { ownerExemption, fetchViaApp, describeViaApp } from './lib/owner-pr.mjs';

const CURATED = new Set(['data/curated/entries.json', 'data/curated/changelog.json']);

export function judge({ files, author, owner, repo, headRepo, headRef, viaApp, mode }) {
  const errors = [];
  if (!owner) return ['リポジトリ変数 MAINTAINER_LOGIN が未設定です（docs/GITHUB-SETTINGS.md）'];
  if (ownerExemption({ author, owner, repo, headRepo, headRef, viaApp, mode }).exempt) return errors;
  if (!files.length) errors.push('変更されたファイルがありません');
  if (files.length >= 300) errors.push('変更されたファイルが多すぎます');
  for (const f of files) {
    const name = String(f.filename);
    const status = String(f.status);
    if (author === 'dependabot[bot]') {
      if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(name) || status !== 'modified') errors.push(`${name}：Dependabot が変えてよいのは .github/workflows/ の既存ファイルだけです（${status}）`);
      continue;
    }
    if (!CURATED.has(name) || status !== 'modified') errors.push(`${name}：運用者以外の PR が変えてよいのは data/curated/ の2ファイルの変更だけです（${status}）`);
    if (f.previous_filename) errors.push(`${name}：ファイル名の変更はできません`);
  }
  return errors;
}

async function listFiles(repo, pr, token) {
  const files = [];
  for (let page = 1; page <= 4; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`GitHub API の応答が異常です（${res.status}）`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error('GitHub API の応答の形が想定と違います');
    files.push(...batch);
    if (batch.length < 100) return files;
  }
  return files; // 300件を超える場合は judge が失敗にする
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GH_TOKEN, REPO, PR_NUMBER, PR_AUTHOR, HEAD_REPO, HEAD_REF, MAINTAINER_LOGIN, OWNER_PR_CHECK } = process.env;
  if (!/^[\w.-]+\/[\w.-]+$/.test(REPO || '') || !/^\d+$/.test(PR_NUMBER || '')) {
    console.error('REPO / PR_NUMBER が不正です');
    process.exit(1);
  }
  try {
    const files = await listFiles(REPO, PR_NUMBER, GH_TOKEN);
    const viaApp = await fetchViaApp(REPO, PR_NUMBER, GH_TOKEN);
    const who = ownerExemption({ author: PR_AUTHOR, owner: MAINTAINER_LOGIN, repo: REPO, headRepo: HEAD_REPO, headRef: HEAD_REF, viaApp, mode: OWNER_PR_CHECK });
    console.log(`PR の作成元（performed_via_github_app）：${describeViaApp(viaApp)}`);
    console.log(`運用者の PR の判定：${who.exempt ? '運用者（範囲の制限なし）' : '制限あり'}（${who.reason}）`);
    const errors = judge({ files, author: PR_AUTHOR, owner: MAINTAINER_LOGIN, repo: REPO, headRepo: HEAD_REPO, headRef: HEAD_REF, viaApp, mode: OWNER_PR_CHECK });
    if (errors.length) {
      console.error(`変更範囲の検査で問題: ${errors.length}件`);
      for (const e of errors) console.error(' - ' + e);
      process.exit(1);
    }
    console.log(`変更範囲の検査OK（${files.length}ファイル）`);
  } catch (e) {
    console.error(`変更範囲の検査に失敗しました（安全のため失敗扱い）: ${e.message}`);
    process.exit(1);
  }
}
