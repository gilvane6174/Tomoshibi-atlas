# 検索で見つけてもらうための設定（運用者向け）

「Tomoshibi Atlas」「ともしびアトラス」「灯の地図」「Yutaka Yoshioka」「吉岡有隆」「ともしびアトラス 吉岡」「Tomoshibi Atlas Yoshioka」などで検索されたときに表示されやすくするための仕組みと、公開後に運用者が行う作業。**検索順位は検索エンジンが決めるため、表示や順位は保証できない。**

## サイト側に入れてあるもの

- 各ページのタイトル・説明文（meta description）に、サイト名の表記ゆれ（Tomoshibi Atlas／ともしびアトラス／灯の地図）と運営者名「Yutaka Yoshioka（吉岡有隆）」を入れている
- 画面の下部と説明ページに「運営：Yutaka Yoshioka（非営利）」、説明ページに「Yutaka Yoshioka（吉岡有隆）」を表示（隠し文字は使わない。検索エンジンの規約違反になるため）
- 構造化データ（JSON-LD）：サイト名・別名・運営者名（Person: Yutaka Yoshioka、別名: 吉岡有隆）
- OGP（SNSで共有されたときの題名・説明）
- 公開URLが分かれば、組み立て時に canonical・hreflang（日英の対応）・sitemap.xml・robots.txt を作る
- 運営者名のローマ字表記は「Yutaka Yoshioka」に統一する

## 公開後に運用者が行うこと

1. リポジトリの **Settings → Secrets and variables → Actions → Variables** に `SITE_URL` を登録（例：`https://<ユーザー名>.github.io/Tomoshibi-atlas/`）。次回の公開から canonical と sitemap.xml が入る
2. Google Search Console にサイトを登録し、所有確認の「HTMLタグ」方式で表示される `content="…"` の値だけを、変数 `GOOGLE_SITE_VERIFICATION` に登録（Bing Webmaster Tools も同様に `BING_SITE_VERIFICATION`）。値は英数字・`-`・`_` のみ受け付ける
3. Search Console で `sitemap.xml` を送信する
4. note・Xのプロフィールなど、すでに「吉岡有隆」「Yutaka Yoshioka」の名前で公開している場所からサイトへリンクする（検索エンジンが同じ運営者だと結び付けやすくなる）

これらの変数は秘密情報ではない（公開ページに表示される値）。APIキーやトークンは不要。
