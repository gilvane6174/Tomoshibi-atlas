# 安全設計と、参考にした実際の攻撃事例

最終見直し：2026-10-25。年に数回、新しい事例を確認してこの表を更新する。

## 守るもの・脅威モデル

| 守るもの | 誰が | 何を狙って | どの経路で |
|---------|------|-----------|-----------|
| 閲覧者 | 攻撃者 | 偽リンク・悪性スクリプトで被害を与える | 改ざんされた取得データ、乗っ取られたAIが出すPR |
| 運用者の個人情報 | 攻撃者・うっかりミス | 特定・晒し | コミット・PR・掲載文への混入 |
| リポジトリと公開サイト | 攻撃者 | 改ざん・踏み台化 | GitHub Actions、依存部品、AI運用者の乗っ取り |
| 情報の正しさ | 攻撃者・AIの誤り | 誤情報・偽情報の掲載 | 偽の原典、AIの要約ミス、翻訳ずれ |
| 取得先の機関 | このサイト自身 | 過剰アクセスによる負担 | 自動取得・AIの調査 |

## 2025〜2026年の事例と、このサイトでの対策

| 事例 | 何が起きたか | このサイトでの対策 |
|------|------------|------------------|
| AIエージェントへのプロンプトインジェクション（2026年4月公表「Comment and Control」、8月 Black Hat USA 2026 での追加報告） | GitHub の Issue・PR・隠しHTMLコメントに書かれた命令で、Claude Code・Gemini CLI・Codex などが秘密情報を漏らす・不正な push をする手口が報告された。Issue の内容が `AGENTS.md` に書き込まれ、後の処理がそれを指示として読み込む例もあった | ① CI で AI を動かさない ② AI は Issue・コメントを指示として読まず、`main` の手順書だけを信頼する（`ops/INJECTION-DEFENSE.md`）③ AI 用アカウントは Workflows 権限なし・2ファイル以外は CI が拒否 ④ CI に保存した秘密情報（secrets）は使わない。ただし、各ジョブには GitHub が発行する一時的なトークン（GITHUB_TOKEN、読み取り中心）があり、公開のジョブには Pages の公開権限と OIDC の一時トークン（pages: write・id-token: write）がある。「漏れる物が無い」わけではないので、PR 側のコードには渡さない・必要なジョブにだけ最小の権限を付ける |
| `pull_request_target` の悪用（2026年2〜4月の Trivy 事件、prt-scan キャンペーン） | 外部からの PR のコードが、書き込み権限・秘密情報つきで実行され、トークン等が盗まれた | `pull_request_target` は **scope-guard.yml だけ**で使う（PR のコードを取り出さず実行もしない。main 側のスクリプトで、変更ファイルの一覧と PR の作成元だけを API で読む。権限は contents: read・pull-requests: read だけ。`scripts/check-repo.mjs` が他のワークフローでの使用と書き込み権限を拒否）。全ワークフローで `permissions: {}` を既定にし、必要な最小権限だけ付与。2026年12月2日以降は Actions のポリシーでこのファイルだけ許可する（docs/GITHUB-SETTINGS.md 8章） |
| AI の連携アプリが運用者の名義で動く（GitHub の仕様：アプリがユーザーの代理で動くと、操作はそのユーザーの名前で記録される） | 作成者名だけで「運用者の PR」と判定すると、AI 経由の PR でも範囲の制限（AI は2ファイルだけ）が外れる | 運用者の PR と認めるのは、GitHub App を通さずに作られたと API（performed_via_github_app）で確かめられたときだけ。確かめられなければ制限する（`scripts/lib/owner-pr.mjs`。scope-guard と validate の両方で同じ判定）。**限界**：PR の作成後に、アプリが運用者の名義でコミットを追加した場合は、コミットの情報だけでは区別できない。そのため、AI の連携アプリには普段このリポジトリへの書き込みを許可せず、push を承認したときだけ一時的に許可し、PR は運用者がブラウザで作る（docs/GITHUB-SETTINGS.md 6章） |
| npm 経由のワームによるリポジトリ改ざん（2026年10月 testmetest：`.github/init.js`、AI・エディタの自動実行設定、`binding.gyp`・`.node`・`.napi_cache`、`skip-checks:true` のコミット） | 開発ツールでフォルダを開いた・パッケージを入れたときに命令が動き、認証情報を盗んで別のリポジトリへ広がる | 外部パッケージを使わない（package.json に依存・インストール時スクリプトなし、ワークフローで npm install しない）。`scripts/check-repo.mjs` が AI・エディタの設定フォルダ、ネイティブ拡張・パッケージ設定のファイル、`.github/` 直下の決まったファイル以外を拒否。`scripts/check-pr-scope.mjs`・`check-history.mjs` が検査を飛ばす指示（skip-checks・skip ci など）のコミットを拒否。これらの検知は混入を止める網で、感染していないことの証明ではない |
| 検査に失敗した PR のコードの実行 | 範囲違反などで止めるべき PR のコードが CI で動く | PR 側のテストと組み立ては、main 側の検査がすべて成功したときだけ実行（validate.yml の `if: ${{ success() }}`。`always()`・`cancelled()` などは `check-repo.mjs` が拒否）。`--offline` は通信を遮断する仕組みではない |
| Action のタグ書き換え（2025年3月 tj-actions/changed-files、2026年5月 actions-cool 系） | 人気 Action のタグが悪性コミットに付け替えられ、タグ指定の利用者が秘密情報を盗まれた | すべての Action を**コミットSHAで固定**（上流リポジトリで実在を確認済み）。GitHub の「SHA固定を必須にする」設定も有効化（`GITHUB-SETTINGS.md`）。Dependabot の更新 PR は内容を確認してからマージ |
| npm の自己増殖型ワーム（2025年9月・11月 Shai-Hulud、2026年4月 SAP 関連パッケージ） | インストール時に実行されるスクリプトが秘密情報を盗み、さらに他のパッケージへ広がった | npm パッケージを**一切インストールしない**設計。描画ライブラリは固定版を同梱し、SHA-256 を記録 |
| リリース工程の侵害（2026年 Checkmarx・Bitwarden CLI） | 正規の配布物に悪性コードが混入した | 外部のバイナリ・CLI を CI で使わない。Node.js 標準機能だけで動く |

## このサイトの多層防御（まとめ）

1. **持たない**：サーバー・ログイン・フォーム・APIキー・秘密情報・閲覧者データを持たない
2. **AIを自動処理に入れない**：自動取得は決まったプログラムだけ
3. **書き込ませない**：自動更新は `contents: read`。AI は2ファイルへの PR だけ
4. **検査で止める**：範囲・個人情報・コミット情報・形式・断定表現・リンク先・見えない文字・更新履歴の整合を CI が検査し、失敗したら公開しない。PR の検査は **main 側のスクリプト**で行うため、PR でスクリプトを書き換えてもすり抜けられない
5. **失敗したら前回を残す**：取得・検査の失敗時は公開を止める
6. **画面で実行させない**：表示はすべて `textContent`、CSP で外部通信・インラインスクリプトを禁止
7. **人が最後に決める**：書く者と監査する者を分け、運用者がマージする
8. **相手に迷惑をかけない**：定時の取得は1日2回（ほかに main の更新時・手動実行時のみ）、AI の調査もアクセス回数を制限（`ops/SCHEDULE.md`）

## 残っている限界（正直な記録）

- CI の断定表現検査は語のリストによる仕掛け線で、言い換えは完全には防げない。人のレビューが前提
- GitHub Pages では HTTP ヘッダーを設定できず、クリックジャッキング対策（frame-ancestors）は効かない。このサイトはログインも操作による被害も無いため影響は小さい
- `ユーザー名.github.io` の下で公開する場合、同じアカウントの他の Pages と同じオリジンになる
- `pull_request` のワークフロー定義は PR 側のものが使われるため、ワークフロー自体を書き換えた外部（フォーク）からの PR は検査を偽装できる。AI 用アカウントは Workflows 権限が無いのでこれはできない。外部の PR は「実行前に承認」の設定と、運用者による差分の確認で防ぐ
- 取得先（WHO・CISA）そのものが改ざんされた場合、見出しの文字列は検査を通れば表示される。ただしリンク先は許可された公式URLの形に限られ、スクリプトとして実行されることはない

## 参考資料

- Cloud Security Alliance, "Comment and Control: When a GitHub Issue Steals CI Secrets"（2026年8月）https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-coding-agent-ci-prompt-injection-202608/
- Cloud Security Alliance, "prt-scan: GitHub Actions Supply Chain Campaign"（2026年4月）https://labs.cloudsecurityalliance.org/research/csa-research-note-github-actions-prt-scan-supply-chain-2026/
- DEV Community, "GitHub Actions supply chain in 2026"（tj-actions、Trivy、Bitwarden ほかのまとめ）https://dev.to/alejandxr/github-actions-supply-chain-in-2026-tj-actions-trivy-bitwarden-and-the-year-the-bots-showed-up-239n
- "Popular GitHub Action Tags Redirected to Imposter Commit"（2026年5月）https://blog.rankiteo.com/git1779179198-github-cyber-attack-may-2026/
- GitHub Changelog, "GitHub Actions policy now supports blocking and SHA pinning actions"（2025年8月）https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/

## 悪用防止（このサイトの情報を、攻撃する側に使わせないために）

脅威モデル：クラッカーなどが、このサイトに集まった「悪用が確認された脆弱性」「各国の相談窓口」などの情報を、攻撃対象の選定・なりすまし・詐欺に使おうとする。または、このサイト自体を改ざんして閲覧者をだまそうとする。

| 対策 | 内容 |
|------|------|
| 載せる情報を絞る | ITセキュリティは公的機関が公表済みで、対処方法が示されているもの（CISA KEV など）だけ。攻撃手順・攻撃コード・痕跡情報（IP・ハッシュ）・未公開/未修正の脆弱性・被害組織のシステム詳細は載せない |
| 機械的な検査 | `findAttackDetail()`（scripts/lib/safety.mjs）が、手動掲載の文とリンク集に IP アドレス・ハッシュ値・コマンド・攻撃コードや攻撃手順を示す語が入ると CI を止める |
| リンク先の制限 | 許可リスト（allowed-sources.json）にある公的機関・学術誌だけ。攻撃コードの置き場になりうるサイト（コード共有サイト・エクスプロイト集など）は載せられない |
| 対処への誘導 | セキュリティの各項目の下に「該当製品を使っている人は公式情報に従って更新・対処」と表示し、攻撃のやり方は載せないことを明示 |
| なりすまし対策 | 「このサイトが個人情報・パスワード・お金を求めることはない」と画面と説明ページで明示。公式リンクにはドメインを表示し、偽サイトとの見分けを助ける |
| 改ざん対策 | main への変更は運用者の承認つき PR のみ、CI（範囲・内容・形式・同梱ライブラリの SHA-256・CSP・Trusted Types）、ワークフローは SHA 固定・権限なし |
| 連絡窓口 | `/.well-known/security.txt`（GitHub の非公開の脆弱性報告フォームを案内。個人の連絡先は載せない） |
| 緊急停止 | `ops/AI-PAUSE` で AI・bot の PR を一括停止（ops/INCIDENT.md） |

限界：公表済みの情報は、もともと誰でも見られる。このサイトは「より見つけやすくする」だけで新しい攻撃能力は与えないが、ゼロにはできない。そのため、件数を絞り、各項目を「対処」とセットで見せる設計にしている。
