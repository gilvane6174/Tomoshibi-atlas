// 「運用者（人間）の PR」かどうかの判定。scope-guard.mjs と check-pr-scope.mjs の両方がこれを使う（判定をそろえる）。
//
// 背景：GitHub App がユーザーの代理で動くと、その操作はユーザー本人の名前で記録される
// （https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user）。
// AI の連携アプリ（Claude・ChatGPT Codex・Copilot など）が運用者の名義で PR を作ると、作成者名だけでは人間と区別できない。
//
// そこで、範囲の制限を外すのは次の全部を満たすときだけにする（1つでも分からなければ、制限を外さない）：
//   1. 作成者が運用者（MAINTAINER_LOGIN）
//   2. 同じリポジトリのブランチ（フォークではない）
//   3. ブランチ名が curated/ で始まらない（curated/ は AI・bot 用）
//   4. PR が GitHub App を通さずに作られたことが、GitHub の API で確かめられた
//      （PR の issue 情報の performed_via_github_app が null。アプリを通した作成なら、そのアプリの情報が入る）
//      取得の失敗・項目の欠落・想定外の形は「確かめられない」として、制限を外さない。
//
// 限界（docs/SECURITY-DESIGN.md に記載）：PR の作成後に、アプリが運用者の名義でコミットを追加した場合、コミットの情報だけでは
// アプリ経由かどうかを区別できない。そのため、AI の連携アプリには普段このリポジトリへの書き込みを許可しない（運用者の設定）。

// viaApp：performed_via_github_app の値。null＝アプリを通していない、オブジェクト＝アプリ経由、undefined＝確かめられない
export function ownerExemption({ author, owner, repo, headRepo, headRef, viaApp }) {
  if (!owner) return { exempt: false, reason: 'リポジトリ変数 MAINTAINER_LOGIN が未設定' };
  if (author !== owner) return { exempt: false, reason: '作成者が運用者ではない' };
  if (!repo || headRepo !== repo) return { exempt: false, reason: 'フォークまたは別リポジトリからの PR' };
  if (String(headRef || '').startsWith('curated/')) return { exempt: false, reason: 'curated/ ブランチ（AI・bot 用）' };
  if (viaApp === undefined) return { exempt: false, reason: 'GitHub App を通さずに作られたかを確かめられない（取得失敗・項目なし）' };
  if (viaApp !== null) {
    const name = typeof viaApp === 'object' && typeof viaApp.slug === 'string' ? viaApp.slug.replace(/[^\w.-]/g, '') : '不明';
    return { exempt: false, reason: `GitHub App（${name}）を通して作られた PR` };
  }
  return { exempt: true, reason: '運用者が GitHub App を通さずに作った PR' };
}

// GitHub の API から performed_via_github_app を読む。読めない・形が違うときは undefined（＝確かめられない）
export async function fetchViaApp(repo, prNumber, token) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^\d+$/.test(String(prNumber || ''))) return undefined;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}`, {
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return undefined;
    const body = await res.json();
    if (!body || typeof body !== 'object' || !('performed_via_github_app' in body) || !body.pull_request) return undefined;
    const v = body.performed_via_github_app;
    return v === null || (typeof v === 'object' && !Array.isArray(v)) ? v : undefined;
  } catch {
    return undefined;
  }
}

// GitHub Actions の実行を止める・飛ばす指示（コミットメッセージ）。このリポジトリでは使わない（検査の回避に使われるため）
// 例：「skip-checks: true」（JFrog の testmetest 調査で使われた）、「[skip ci]」など。大小文字・空白の違いも同じに扱う
export const SKIP_CHECKS = /skip-checks\s*:\s*true|\[\s*(skip\s+ci|ci\s+skip|no\s+ci|skip\s+actions|actions\s+skip)\s*\]/i;
