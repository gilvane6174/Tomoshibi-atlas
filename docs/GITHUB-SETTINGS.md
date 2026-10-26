# GitHub 側で運用者が手動で行う設定

公開前に、上から順にすべて設定してください。ここが抜けると、ファイル側の安全設計が効きません。
（画面の項目名は GitHub の更新で変わることがあります。見つからない場合は近い名前の項目を探してください）

## 0. アカウント

- [ ] 2要素認証（2FA）が有効になっている
- [ ] Settings → Emails →「Keep my email addresses private」と「Block command line pushes that expose my email」を有効にし、コミットに使うメールを GitHub が用意する noreply アドレス（末尾が users.noreply.github.com のもの）にする
- [ ] ローカルで作業する場合、`git config user.email` が noreply アドレス、`git config user.name` が GitHub のユーザー名になっている（本名を入れない。CI が拒否する）

## 1. リポジトリ作成

- [ ] 専用の新規リポジトリ `Tomoshibi-atlas` を作る（他のプロジェクトと混ぜない）
- [ ] 無料プランで GitHub Pages を使う場合は **Public** が必要。中身に秘密情報が無いことを公開前に再確認する
- [x] `.github/CODEOWNERS` は `@gilvane6174` に設定済み（別のアカウントで運用する場合は置き換える。仮の名前のままだと CI の `check-repo` が失敗し、公開されない）

## 2. Actions の権限

Settings → Actions → General

- [ ] Actions permissions：「Allow … and select non-…」で **GitHub が作成した Action のみ** を許可（`actions/*` だけ使っているため）
- [ ] **「Require actions to be pinned to a full-length commit SHA」を有効化**（タグ書き換え攻撃への対策。2025年8月に GitHub が追加した設定）
- [ ] Workflow permissions：**Read repository contents and packages permissions**（読み取りのみ）
- [ ] 「Allow GitHub Actions to create and approve pull requests」：**オフ**
- [ ] Fork pull request workflows：外部の協力者からの PR は **承認してから実行**（Require approval for all external contributors）

## 2.5 リポジトリ変数

Settings → Secrets and variables → Actions → **Variables**（Secrets ではない）

- [ ] `MAINTAINER_LOGIN` に運用者の GitHub ユーザー名を登録する。PR の範囲検査で「運用者の PR か」を判定するのに使う（未登録だと全 PR が失敗する＝安全側）
- [ ] AI 用アカウントを作ったら `AI_ACCOUNT_LOGINS` にそのユーザー名を登録する（複数ならカンマ区切り）。コミットの作者名がこの一覧と運用者以外だと PR が失敗する

## 2.6 Issue・コメントからの攻撃対策

- [ ] Settings → General → Features：Discussions・Wiki・Projects は使わないならオフ
- [ ] Issue は誤り報告の受付に使うが、AI・bot が Issue をきっかけに自動で動く仕組みは作らない（`ops/INJECTION-DEFENSE.md`）
- [ ] 荒らしが来たら Settings → Moderation options → Interaction limits で一時的に制限する

## 3. GitHub Pages

Settings → Pages

- [ ] Source：**GitHub Actions**
- [ ] Settings → Environments → `github-pages` → Deployment branches：**main のみ**

## 4. main ブランチの保護（Rulesets）

Settings → Rules → Rulesets → New branch ruleset（対象：`main`）

- [ ] Restrict deletions（削除禁止）
- [ ] Block force pushes（force push 禁止）
- [ ] Require a pull request before merging（PR 必須）
  - [ ] Required approvals：1
  - [ ] Require review from Code Owners（CODEOWNERS の承認必須）
  - [ ] Dismiss stale pull request approvals when new commits are pushed
- [ ] Require status checks to pass：`validate` と **`scope-guard`** の2つ（scope-guard は main 側の定義だけで動き、AI・外部の PR が data/curated の2ファイル以外を変えていたら必ず失敗する。PR でワークフローを書き換えても効かない）。validate は（PR範囲・個人情報・形式などの検査をすべて含む。検査は main 側のスクリプトで PR 側のファイルに対して行うため、PR で検査スクリプトを書き換えても効かない。PR 側でワークフロー定義そのものを書き換える手口は scope-guard が止める。それでも最後に運用者が「Files changed」を確認する。下の「CI の限界」参照）
- [ ] Bypass list：**自分（運用者）だけ**を追加し、モードは **「For pull requests only」**（「Always」にしない）
  - 理由：自分の PR は自分で承認できないため、自分が直した変更は「PR を作ったうえで承認を省略してマージ」できるようにする。main への直接 push はできず、必ず PR を経由する。この場合は検査（validate）の結果も省略できてしまうため、緑になったことを自分で確認してからマージする
  - AI 用アカウント（6章）は Bypass に**入れない**。AI の PR は必ず運用者の承認が必要になる

## 4.5 AI用アカウントが触れるブランチを限定する（Rulesets）

AI 用アカウントは Write 権限を持つため、何もしないと運用者の作業ブランチにも push できてしまいます。次のルールセットで、AI が更新できるのを `curated/` で始まるブランチだけにします。

Settings → Rules → Rulesets → New branch ruleset
- [ ] 名前：`only-owner-outside-curated`
- [ ] Target branches：Include all branches、Exclude by pattern `curated/**` と `dependabot/**`（Dependabot の更新用。Dependabot の PR は CI で Actions 設定の変更だけに制限される）
- [ ] Rules：Restrict creations、Restrict updates、Restrict deletions、Block force pushes
- [ ] Bypass list：運用者（Always）。**AI 用アカウントは入れない**

あわせて、PR 検査（`scripts/check-pr-scope.mjs`）は `curated/` ブランチからの PR を、作成者が誰であっても AI 扱い（2ファイルのみ）で検査します。運用者自身の作業は `curated/` 以外の名前のブランチで行ってください。

**このルールセットは、運用者の PR に制限をかけない仕組みの前提です。必ず設定してください。** 念のため CI でも、運用者の PR に運用者以外のコミットが混ざっていたら失敗させます。

## 5. セキュリティ機能

Settings → Security（Code security）

- [ ] Private vulnerability reporting：**有効**（SECURITY.md の報告窓口）
- [ ] Secret scanning と Push protection：**有効**
- [ ] Dependabot alerts / security updates：**有効**

## 6. AI 運用者のアカウントとトークン（運用AIが決まってから）

**AI には自分のアカウントのトークンを渡さないこと。** 自分のトークンだと、AI の操作が「運用者本人の操作」になり、
(1) 自分の PR は自分で承認できないので AI の PR がマージできなくなる、(2) それを回避しようと自分をルールセットの例外にすると、AI が main に直接書き込めてしまう、という穴が生まれます。

- [ ] AI 専用の GitHub アカウント（マシンアカウント）を別に作る。名前・プロフィールに個人情報を入れない。2FA を有効にする
- [ ] **リポジトリの置き場所を決める（ここは GitHub の仕様を作業時に要確認）**
  - Fine-grained token は「トークンを作ったアカウント自身」か「そのアカウントが所属する組織（Organization）」のリポジトリにしか使えない、という制限があるとされています。個人アカウントのリポジトリに共同作業者として招待するだけでは、AI 用アカウントの Fine-grained token が作れない可能性があります
  - 推奨：無料の Organization を作り、`tomoshibi-atlas` をそこに置く（または移す）。自分は Owner、AI 用アカウントはメンバーにして **このリポジトリだけ Write** を付与。組織の設定で「Fine-grained token の利用に承認を必要とする」を有効にする
  - 代替：GitHub App を作り、このリポジトリだけにインストールする（Contents・Pull requests を Read and write）
  - **やってはいけない回避策**：自分のアカウントのトークンを AI に渡す／Classic token（権限が広すぎる）を使う
- [ ] AI 用アカウントで Fine-grained personal access token を作る
  - Resource owner：上の Organization／Repository access：**tomoshibi-atlas のみ**
  - Permissions：Contents＝Read and write、Pull requests＝Read and write、Metadata＝Read
  - **Workflows・Actions・Administration・Secrets・Pages・Environments は付与しない**（Workflows が無ければ `.github/workflows/` を変更する push は拒否される）
  - 有効期限：30〜90日。期限が来たら作り直す
- [ ] トークンは AI の設定画面にだけ入力し、チャット・ファイル・Issue には貼らない
- [ ] 不要になったら、トークンの失効（Revoke）とメンバーからの削除を行う

- [ ] 監査担当の AI・bot（`ops/ROLES.md`）を使う場合は、さらに別のアカウントにし、**Read 権限のみ**で招待する（PR へのコメントは Read 権限でも可能）

これで、AI は作業ブランチへの push と PR 作成まではできるが、main への直接書き込み・承認・マージ・ワークフローの変更はできない状態になります。最後に運用者が PR を承認してマージします。

## 6.1 AI アカウントは「読み取り」権限＋フォークからの PR にする（推奨・v0.9）

PR の検査（validate）は、PR 側のワークフローファイルで動く。そのため、AI が `.github/workflows/` を書き換えると、validate を「合格」に見せかけられる。これは **scope-guard（main 側の定義で動く変更範囲の検査）を必須チェックにすることで機械的に塞いでいる**（4章）。さらに次のどちらかで、AI が書き換えられる範囲そのものを狭める。

1. **推奨**：AI アカウントにはリポジトリの **Read（読み取り）だけ**を与え、AI は自分のアカウントのフォークで作業し、そこから PR を出す。外部からの PR として「Actions の実行に運用者の承認が必要」になり、トークンも読み取りだけになる。この場合、ルールセット 4.5 の `curated/**` への push 許可は不要
2. 料金プランで使える場合：push ルールセットで `.github/**`・`scripts/**`・`site/**`・`data/directory/**`・`AGENTS.md`・`ops/**` などの変更を制限し、運用者だけを例外にする

どちらの場合も、**PR の「Files changed」に `data/curated/` 以外のファイルがあれば、検査の結果にかかわらずマージしない**（AI の PR は data/curated の2ファイルしか変えないため）。

### AI が作ったプログラムの修正を取り込む方法

WHO・CISA のデータ形式が変わったときなど、`scripts/` の修正が必要になることがある。AI は `scripts/` を変える PR を出せない（検査で拒否される）ため、AI には修正案（差分）を文章で出してもらい、運用者が内容を読んで理解できた場合だけ、自分のアカウントで手元に反映し、`node scripts/prepublish-check.mjs` を通してから自分の PR として出す。理解できない修正は取り込まない。

## 6.5 知っておくこと（設計上の限界）

- `ユーザー名.github.io/Tomoshibi-atlas` で公開する場合、同じアカウントの他の GitHub Pages サイトと「同じオリジン」になります。このサイトはログインも保存データも持たないため実害はほぼありませんが、同じアカウントで信頼できないページを公開しないでください（気になる場合は独自ドメインを使う）
- GitHub Pages では HTTP ヘッダーを設定できないため、CSP は HTML の meta で指定しています。この方式ではクリックジャッキング対策（frame-ancestors）は効きません

## 7. 公開直前の最終確認

- [ ] `node scripts/test.mjs` と `node scripts/validate-data.mjs` が通る
- [ ] リポジトリ内に個人情報・メールアドレス・トークン・AI との会話 URL が無い（`git log` のコミット作者情報も含む）
- [ ] Actions タブで「Build and deploy」を手動実行（Run workflow）し、成功したら公開ページを確認
- [ ] 初回実行で WHO・CISA の取得が成功したか、件数が妥当か（説明ページの「現在のデータの時点」）を確認


## 追加の設定（v0.4）

- **GitHub のプロフィールの「Name」を、筆名（Yutaka Yoshioka または 吉岡有隆）か空欄にする**（Settings → Public profile → Name）。GitHub がマージ時に作るコミットには、ここの名前が入って公開される。公開ワークフローの `scripts/check-history.mjs` が、noreply 以外のメールや許可外の名前を見つけると公開を止める
- **AI・bot に運用者のアカウントやトークンを使わせない**（運用者の PC で動く AI ツールに、運用者の GitHub ログインのまま操作させない）。運用者の権限で動く AI には、範囲の制限や PR 検査が効かない。AI・bot には必ず専用のアカウント（または組織の機械アカウント）を使う
- main のルールセットの「Bypass list」に運用者を入れている場合も、**検査（status checks）は運用者の PR にも必須**にしておく（緊急時を除き、検査の失敗した変更をマージしない）
- PR 検査（validate.yml）は **main 宛ての PR だけ**で動き、検査プログラムは常に最新の main から読み込む。宛先を別ブランチにした PR は検査で失敗する

- **Settings → Code security → Private vulnerability reporting を有効にする**。サイトの `/.well-known/security.txt` は、このフォームを連絡先として案内する（個人のメールアドレスは載せない）
- **Settings → Code security → CodeQL**：`.github/workflows/codeql.yml` が週1回と PR ごとにコードを検査する。結果は Security タブで確認
- 変数（Variables）：`SITE_URL`・`GOOGLE_SITE_VERIFICATION`・`BING_SITE_VERIFICATION`（いずれも任意・秘密情報ではない）。詳しくは [SEARCH.md](SEARCH.md)
- Node.js：CI は 24 系の最新版を毎回取得する（`check-latest: true`）。さらに `scripts/lib/node-guard.mjs` が、修正前の脆弱性がある版では処理を止める。新しいセキュリティリリースが出たら、この表の最低バージョンを運用者が上げる

## 最初の公開の順番（v0.5）

0. **リンク集の確認**：`node scripts/mark-link-checked.mjs --list` で、まだ表示されていないリンク（確認待ち）を出し、ブラウザで確認できたものを記録する（ops/LINK-SAFETY.md）。確認しなかったものは表示されないだけなので、全部を終えなくても公開はできる
1. 手元で `node scripts/prepublish-check.mjs` を実行し、すべて OK になることを確認する（個人情報・全ブランチの全ファイルの全版とコミットメッセージ・作者情報・設定・テスト・データ・組み立て）
2. GitHub で **空の・非公開（Private）の** リポジトリ `Tomoshibi-atlas` を作る（README なども作らない）。公開リポジトリは push した瞬間に誰でも中身と履歴を読めるため、最初は非公開で確かめる
3. 先に設定する：Pages の Source を「GitHub Actions」に、変数 `MAINTAINER_LOGIN`（gilvane6174）・`AI_ACCOUNT_LOGINS`・`SITE_URL`（`https://gilvane6174.github.io/Tomoshibi-atlas/`）、ルールセット（main・タグ）、Private vulnerability reporting
4. push して、Actions（公開・検査・CodeQL）の結果と、リポジトリの中身（Files・Commits）を自分の目で確認する
   - 非公開のうちに確かめる：Actions の Link safety check を手動で1回実行し、結果を見る／わざと禁止されている変更（例：links.json の変更）を含む PR を作って、検査で拒否されるか見る／`ops/AI-PAUSE` を置いた PR が拒否されるか見る／失敗の通知がメールなどで届くか見る
   - 公開後に確かめる：公開サイトで `.well-known/security.txt` が開けるか／スマホで地球儀・現在地ボタン・リンク集が使えるか／外部の人の PR が、設定の都合だけで弾かれていないか（変数 `MAINTAINER_LOGIN` がフォークからの PR でも読めるか）
   - ご意見フォーム（Google フォーム）：「回答を1回に制限」がオフ（ログイン不要）になっているか。メールアドレスの収集はオン（サイトに明記済み）
5. 問題がなければ、リポジトリを **Public** に切り替える（無料プランの Pages は公開リポジトリで動く。非公開のままでは公開されない場合がある）
5. CodeQL は `.github/workflows/codeql.yml` で動かす。Settings の CodeQL「Default setup」は**有効にしない**（二重に動いて衝突するため）

## タグとリリースの保護

- ルールセットを **Tags（すべてのタグ）** にも作り、作成・更新・削除を運用者だけに制限する（AI・bot のアカウントがタグやリリースを作れないように）

## 検索エンジンの robots.txt / security.txt について

- `https://gilvane6174.github.io/Tomoshibi-atlas/` のようなプロジェクトサイトでは、`robots.txt` と `.well-known/security.txt` はサイトのフォルダ内に置かれ、ドメイン直下にはならない。検索エンジンへのサイトマップの送信は Search Console から行う（docs/SEARCH.md）

## CI の限界と、運用者の最終確認（重要）

- `pull_request` で動く検査は、**PR 側のブランチに含まれるワークフロー定義**で動く。AI・bot のアカウントや外部の人が `.github/workflows/` を書き換えた PR を出すと、検査を省略して「合格」に見せることができる。検査プログラム自体は main から読み込むが、**起動する手順書（ワークフロー）までは固定できない**
- そのため、次の3つを必ず設定・実行する
  1. Settings → Actions → General →「Fork pull request workflows from outside collaborators」で **「Require approval for all external contributors」**（外部の人の PR の検査は、運用者が承認するまで動かない）
  2. CODEOWNERS（`.github/` と `scripts/` は運用者の承認が必須）とルールセットの「Require review from Code Owners」
  3. マージの前に、運用者が PR の「Files changed」を見て、**2つのデータファイル以外が変わっていればマージしない**（PR テンプレートの「運用者の最終確認」）
- ルールセットの「Require branches to be up to date before merging」（strict）を有効にする。緊急停止（ops/AI-PAUSE）の前に通った古い検査結果のままマージされるのを防ぐ
- 運用者の Bypass は「For pull requests only」で、**通常は使わない**（検査が失敗した PR をマージしない）。使った場合は、理由を更新履歴に記録する
- `dependabot/**` はブランチ制限の対象外になっている。AI・bot のアカウントがこの名前のブランチを作っても、PR 検査が Dependabot 以外のコミットを拒否するが、念のため AI 用トークンの権限は「このリポジトリの Contents と Pull requests」だけにし、Workflows 権限は与えない
- Node.js の修正済み版の確認（`scripts/lib/node-guard.mjs`）は、GitHub Actions でも手元でも、修正前の版なら処理を止める（2026-10-26 変更。以前は Actions では警告だけだった）。Actions は毎回その系列の最新版を入れるので通常は止まらない。止まったときは、最新版の配布待ちか表の値の誤りなので、運用者が表を確かめる（公開中のサイトは前回の内容のまま残る）。`TA_ALLOW_OLD_NODE=1` は手元で試すとき専用で、Actions では効かない
- `scripts/check-privacy.mjs` などの検査は、決まった形の文字列を探す仕組み。**検査が通ったことは「個人情報が無い証明」ではない**

## リンク確認の通知（v0.7）

週1回のリンク安全確認（Link safety check）は、危険・要確認のリンクがあると「失敗」になります。失敗に気づけるように、次を設定してください。

1. GitHub の右上のアイコン → Settings → Notifications → 「Actions」で、失敗したワークフローの通知（Web とメール）を受け取る設定にする
2. リポジトリの Watch を「All Activity」または「Custom → Actions など」にする（自分のリポジトリでも通知を受け取るため）
3. 失敗したら、Actions → Link safety check → 実行結果の Summary に、危険・要確認のリンクが一覧で出る。危険は外すか差し替え、要確認はブラウザで開いて確かめる
4. 通知が来ない場合に備え、月に1回は Actions の画面で最新の実行結果を目で確認する

## 8. 2026年12月2日までに必要な設定：変更範囲の検査（scope-guard）を動かし続ける
GitHub は、公開リポジトリで `pull_request_target` で動くワークフローを、**2026年12月2日から既定で止める**と発表した（GitHub Changelog 2026-09-17「Workflow execution protections in GitHub Actions generally available」、10月21日に日付を更新）。
このリポジトリの `.github/workflows/scope-guard.yml` はこの仕組みで動いているため、何もしないと12月2日以降に検査が動かず、必須の検査（scope-guard）が終わらないので PR を取り込めなくなる。

`pull_request`（通常の PR の起動条件）に変えるのは**勧めない**。`pull_request` では PR 側のワークフローの定義が使われるため、PR の中で scope-guard.yml を書き換えると検査をすり抜けられてしまう（この検査を作った理由そのもの）。

手順（運用者が GitHub の画面で行う。画面の名前は変わることがある）：
1. リポジトリの **Settings → Actions → Policies**（「Actions policies」）を開く
2. 新しいポリシーを作る。名前は例として「scope-guard だけ pull_request_target を許可」
3. 対象（target）を **ワークフローのファイル `.github/workflows/scope-guard.yml` だけ**に絞る（workflow file targeting）
4. **Restrict events** で `pull_request_target` を許可する
5. **Restrict actors** を設定する場合は、運用者・Dependabot・AI 用アカウントが PR を出せる状態を保つ
6. 状態を Active にして保存。次の PR で「Scope guard」が動くことを確かめる
7. ほかのワークフローには `pull_request_target` を許可しない（`scripts/check-repo.mjs` も scope-guard 以外での使用を禁止している）

参考：GitHub Docs「Control workflow execution」「About Actions policies」。Evaluate（試験）モードは GitHub Enterprise Cloud だけのため、この設定は Active で行う。

## 9. 推奨：すべてのブランチでワークフローの追加・変更を制限する
2026年10月には、盗まれたトークンで約1,900のアカウントに不正なワークフローを置く攻撃（GhostAction）が報告された。main 以外の新しいブランチに置かれたワークフローも `push` で動くため、次を推奨する。
- **Settings → Rules → Rulesets** で、対象ブランチを **All branches（すべてのブランチ）** にしたルールを作り、「Restrict file paths」で `.github/workflows/**` の変更を制限する（運用者だけ bypass）
- 個人アクセストークン（classic）は作らない。必要なら期限の短い fine-grained トークンにする
- ログインには、パスキーかセキュリティキーを使う
- **Settings（アカウント）→ Applications → Authorized OAuth Apps** と、ログイン中のセッションを、月に1回見直す

## 10. 運用者が「検査のプログラム」と「データ」を同時に変えるときの取り込み方（2段階・迂回しない）
`validate.yml` の「Data validation (trusted)」などは、**main 側（取り込み前）の検査プログラム**で PR のデータを調べる。
そのため、新しい分野・新しい印（tags）・新しい許可ドメインを使うデータを、検査プログラムの更新と同じ PR に入れると、古い検査プログラムが新しいデータを知らずに失敗する（設計どおり。AI や外部の PR が検査プログラムを書き換えて通すことを防ぐため）。

**この場合も、検査を迂回して取り込まない。** 次の2段階に分ける。

1. **段階1：検査プログラムだけを先に入れる PR**
   - 中身：scripts/・site/・docs/・ワークフローなどの変更と、**今の main の検査で通るデータだけ**（新しい分野・印・ドメインを使うデータは入れない）
   - 新しい検査で必要になる確認の記録（evidence など）がまだ無いデータは、空のまま入れる（例：都道府県の窓口のリンクを空にして「確認中」表示にする）
   - main 側の検査（trusted）と、PR 側の自己テスト・組み立てが**すべて成功する**ことを確かめてから取り込む
2. **段階2：データの PR**
   - 段階1を取り込んだ後の main（新しい検査プログラム）で検査される
   - trusted の検査・自己テスト・組み立てが**すべて成功する**ことを確かめてから取り込む

確かめ方：
- PR の「Checks」で、Validate と Scope guard の全手順が緑（成功）であること。trusted の手順が赤のまま取り込まない
- 失敗したら、ログを開いて理由を読む（trusted が失敗しても、PR 側の自己テストと組み立ては原因調べのために続けて動く。ただし成功しても trusted の失敗は消えない）
- 手元で `npm test`、`npm run validate`、`node scripts/check-repo.mjs`、`node scripts/check-privacy.mjs`、`npm run check:history` も実行しておく（Node.js は修正済みの版。古い版では止まる）

管理者の権限でルールを迂回して取り込むのは、**サイトが壊れていて直す PR 自体が検査を通せないなど、ほかに方法がない緊急時だけ**。その場合は、対象の head SHA、失敗した手順と理由、手元で実行した検査の結果を PR に書き、取り込み後すぐに通常の検査が通る状態へ戻す。AI・外部の PR では絶対に迂回しない。
