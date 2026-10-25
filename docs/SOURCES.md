# 情報源と利用条件のメモ

「確認状況」が **未確認** のものは、公開前または有効化前に運用者が一次情報で確認すること。

| 情報源 | 使い方 | 掲載するもの | 利用条件 | 確認状況 |
|--------|--------|-------------|---------|---------|
| WHO Disease Outbreak News API（`www.who.int/api/news/diseaseoutbreaknews`） | 毎日自動取得 | 見出し・公表日・原典リンクのみ（本文は転載しない） | WHO の出版物は CC BY-NC-SA 3.0 IGO（非営利・出典表示）。WHO ロゴは使用不可。WHO が本サイトを承認しているかのような表現は不可 | 方針は WHO 著作権ページで確認済み（2026-10）。API の実際の応答形式は **初回実行で確認** |
| CISA Known Exploited Vulnerabilities Catalog（JSON） | 毎日自動取得 | CVE番号・製品名・追加日・NVDへのリンク | CC0 1.0（CISA 公式の GitHub リポジトリ cisagov/kev-data の LICENSE で確認）。CISA のロゴは使わず、CISA が本サイトを推薦しているかのような表現はしない | 確認済み（2026-10） |
| JPCERT/CC RSS（`www.jpcert.or.jp/rss/jpcert.rdf`） | 自動取得（**現在は無効**） | 注意喚起の見出し・日付・リンク | 利用条件 **未確認**。フィードのURLも **未確認** | **未確認**：確認後に `scripts/allowed-sources.json` の `enabledFetchers.jpcertRss` を `true` にする |
| Natural Earth（国境・国名データ） | 同梱 | 地図の形（「日本から見た国境」版 ne_10m_admin_0_countries_jpn を scripts/prepare-geo.mjs で簡略化）、国名（日本語含む）、表示位置 | パブリックドメイン | 確認済み（取得元リポジトリの LICENSE） |
| d3-geo 3.1.1 / d3-array 3.2.4 | 同梱 | 地球儀の描画 | ISC ライセンス（`site/vendor/LICENSE-*.txt`） | 確認済み |
| 厚生労働省「まもろうよ こころ」 | リンクのみ | 相談窓口の案内 | リンクのみ | URL 確認済み（2026-10） |

## 自動取得の仕様（AI 不使用）

- WHO：見出しの「病名 – 国名」を機械的に分解。国名が対応表にない場合は地球儀に置かない。病名は `scripts/disease-names-ja.json` の対訳表にあるものだけ日本語化し、無ければ英語のまま
- CISA：追加から30日以内の項目のみ。位置は発表機関の所在国（米国）
- 取得件数が異常に少ない、形式が違う、検査に通らない場合は公開を中止

## 国・分野別の公式リンク集（data/directory/links.json）

国を選んだときに詳細の下部に表示する、公的機関などの公式サイトへのリンク集。

- ページを開いて公式サイトであることを確認したURLだけを載せる（AIによる調査と別のAIによる確認を含む。`reviewedAt` が確認日、URLごとの記録は `data/directory/evidence.json`）。運用者は evidence.json の記録をもとに順次ブラウザで確認する。検索結果の抜粋や記憶だけで追加しない
- 載せてよいのは `scripts/allowed-sources.json` の `directoryHosts` に一致する https のURLだけ（`?` や `#` つきは不可）
- 各リンクは日本語（`ja`）・ひらがな（`jaKana`、漢字なし）・英語（`en`）の名前と短い説明が必須
- 福祉のリンクは「困りごと」分類（`categories`）に必ず属させる
- 2026年10月25日時点の収録：93の国・地域と世界共通（公的機関の公式 X アカウント12件を含む）。未確認の国は「準備中」と表示する
- リンクの安全基準と週1回の自動確認は [ops/LINK-SAFETY.md](../ops/LINK-SAFETY.md)

## 原典の利用条件についての方針

- WHO：見出し（英語原文）・公表日・対象国・原典リンクを掲載。病名の日本語表記と短い要約は本サイトが独自に作成したもので、WHO が作成・確認したものではない旨を説明ページに明記している（WHO の著作権方針は翻訳・翻案に同様の注意書きを求めている）。非営利・出典明記
- CISA KEV：米国 CISA が公開する機械可読のデータ（cisa.gov、同じ内容を CISA が GitHub の cisagov/kev-data でも公開）。CVE 番号・製品名・追加日などの事実情報のみを使い、説明文は転載しない。利用条件は CC0 1.0（cisagov/kev-data の LICENSE で確認済み）
- WHO のウェブサイト上の情報（ニュース・DON など）は、WHO のウェブサイト利用条件（https://www.who.int/about/policies/terms-of-use）に沿って、出典（WHO・URL）を明記し、見出しと、事実を本サイトの言葉でまとめた短い要約に限って使う（本文の転載・翻訳はしない）。WHO の出版物をもとにした翻案は CC BY-NC-SA 4.0 で提供する（about ページに明記）。
- 厚生労働省の資料は、同省ホームページの利用規約に沿って出典（資料名・URL）を各項目に表示し、要約・数値の抜き出しは本サイトが編集・加工したもので同省が作成したものではない旨を about ページに明記する。WHO の方針では、IGO 版は国際機関だけが使えるライセンスで、翻訳・翻案は同様の条件の CC BY-NC-SA 3.0 または 4.0 にする（https://www.who.int/about/who-we-are/publishing-policies/copyright で確認、2026-10-25）。「WHO が作成・確認したものではない」旨の注記を必ず残す
- 手動掲載の要約：原典の文章を写さず、事実（数値・日付・主体）を短く自分の言葉で書き、必ず出典を付ける
