# 情報源と利用条件のメモ

「確認状況」が **未確認** のものは、公開前または有効化前に運用者が一次情報で確認すること。

| 情報源 | 使い方 | 掲載するもの | 利用条件 | 確認状況 |
|--------|--------|-------------|---------|---------|
| WHO Disease Outbreak News API（`www.who.int/api/news/diseaseoutbreaknews`） | 1日2回（朝・夕方）自動取得 | 見出し・公表日・原典リンクのみ（本文は転載しない） | WHO の出版物は CC BY-NC-SA 3.0 IGO（非営利・出典表示）。WHO ロゴは使用不可。WHO が本サイトを承認しているかのような表現は不可 | 方針は WHO 著作権ページで確認済み（2026-10）。API の実際の応答形式は **初回実行で確認** |
| CISA Known Exploited Vulnerabilities Catalog（JSON） | 1日2回（朝・夕方）自動取得 | CVE番号・製品名・追加日・NVDへのリンク | CC0 1.0（CISA 公式の GitHub リポジトリ cisagov/kev-data の LICENSE で確認）。CISA のロゴは使わず、CISA が本サイトを推薦しているかのような表現はしない | 確認済み（2026-10） |
| JPCERT/CC RSS（`www.jpcert.or.jp/rss/jpcert.rdf`） | 1日2回自動取得（**有効**。ITセキュリティ、注意喚起（/at/年/…）だけ。取得に失敗しても CISA の情報は残し、画面下の取得状態に「JPCERT/CC は今回は取得できませんでした」と出す（v1.2.6）。公開の処理（GitHub Actions）での実際の取得はまだ確認していない） | 注意喚起の見出し・日付・リンク | RSS の案内ページ（https://www.jpcert.or.jp/rss/）に「どなたでも自由にご使用ください」。再配布の禁止の記載なし | 確認済み（2026-10-27。RSS 1.0・UTF-8・DOCTYPE なし・リンクは www.jpcert.or.jp。週報の項目には # があるが、注意喚起だけを取り込むため対象外） |
| USGS 地震情報（`earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson`） | 1日2回（朝・夕方）自動取得（取得できなくても公開は止めない） | マグニチュード・場所の表記・発生時刻・USGSの地震ページへのリンク（過去30日のM5.5以上を新しい順に最大50件） | 米国政府の著作物。USGSの方針（www.usgs.gov/faqs/how-should-i-cite-a-usgs-website）で、出典（U.S. Geological Survey）を示せば自由に利用可。USGSが推薦しているかのような表現はしない。自動のアプリにはリアルタイム配信の利用が推奨されているため、検索APIではなく配信を使う | 確認済み（2026-10-26） |
| 英国 NCSC 新着（`www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml`） | 1日2回自動取得（**有効**。防犯、最大6件） | 見出し・公表日・リンクのみ | Open Government Licence v3.0（https://www.ncsc.gov.uk/terms-and-conditions で確認）。出典の表示と OGL へのリンクが必要。ロゴ・第三者の画像は使えない | 確認済み（2026-10-26） |
| 金融庁 新着（`www.fsa.go.jp/fsaNewsListAll_rss2.xml`） | 1日2回自動取得（**有効**。防犯、詐欺・無登録業者などの見出しだけ、最大8件） | 見出し・公表日・リンクのみ | RSS の案内ページ（https://www.fsa.go.jp/kouhou/rss.html）に再配布の禁止は無い。サイトの利用ルール（https://www.fsa.go.jp/rules/）：特記がない限り公共データ利用規約（第1.0版、PDL1.0。CC BY 4.0 互換）に準拠。出典「金融庁ウェブサイト（URL）」の記載が必要。加工したものを国が作成したかのように公表しない。リンクは自由 | 確認済み（2026-10-26。RSS は UTF-8・DOCTYPE なし・リンクはすべて www.fsa.go.jp） |
| 消防庁 災害情報（`www.fdma.go.jp/disaster/info/index.xml`） | 1日2回自動取得（**有効**。防災、最大10件。同じ災害の続報は最新の報を目立たせる） | 見出し・公表日・リンクのみ | RSS の案内ページ（https://www.fdma.go.jp/about/rss.html）に再配布の禁止は無い。利用ルール（https://www.fdma.go.jp/about/others/post3.html）：PDL1.0。出典「消防庁ホームページ」等の記載が必要。加工したものを国が作成したかのように公表しない。ロゴ・キャラクターは対象外。リンクフリー | 確認済み（2026-10-26）。RSS のリンクは一覧ページへの相対パス＋ページ内の目印（例 `/disaster/info/#070300`）で、pubDate は第1報の日付。見出しの「R8.10.26更新」を公表日として使う（scripts/fetch-feeds.mjs） |
| 米国 FTC 消費者保護の報道発表（`www.ftc.gov/feeds/press-release-consumer-protection.xml`） | 1日2回自動取得（**有効**。防犯、最大6件） | 見出し・公表日・リンクのみ | FTC の Website Policy（https://www.ftc.gov/policy-notices/website-policy）：大半は米国政府の著作物でパブリックドメイン。出典の表示（例 Source: United States Federal Trade Commission, www.ftc.gov）を求める。推薦・提携を示唆しない。紋章の使用不可 | 確認済み（2026-10-26。RSS 2.0・UTF-8・DOCTYPE なし・リンクは www.ftc.gov） |
| 米国 NASA 報道発表（`www.nasa.gov/news-release/feed/`） | 1日2回自動取得（**有効**。研究と対策、最大10件。リンク先は `www.nasa.gov/news-release/` 以下だけ） | 見出し・公表日・リンクのみ | NASA の Images and Media Guidelines（https://www.nasa.gov/nasa-brand-center/images-and-media/）：NASA の資料は原則として米国で著作権の対象外。情報提供・教育目的の利用（ウェブサイトを含む）は個別の許可なしで可。出典として NASA を示す。記章・ロゴ・識別子は使えない。推薦を示唆しない。フィードの一覧は https://www.nasa.gov/rss-feeds/ | 利用条件は確認済み（2026-10-27）。**フィードの中身はこちらの環境から開けず未確認**（公式一覧の掲載のみ確認。報道発表のページは www.nasa.gov/news-release/〈名前〉/ の形）。形が違えば、その見出しは除かれ、画面に「取得できなかった」と出る |
| 米国 NIH 報道発表（`www.nih.gov/news-releases/feed.xml`） | 1日2回自動取得（**有効**。研究と対策、最大10件。リンク先は `www.nih.gov/news-events/news-releases/` 以下だけ） | 見出し・公表日・リンクのみ | NIH の FAQ（https://www.nih.gov/about-nih/frequently-asked-questions）：サイトの情報の多くはパブリックドメインで、無料・制限なしで利用可（第三者の資料を除く）。推薦・宣伝の印象を与えない。ロゴは推薦を示唆する使い方をしない | 確認済み（2026-10-27。RSS 2.0・UTF-8・DOCTYPE なし・リンクは www.nih.gov で ? や # なし。pubDate が「Fri, 10/23/2026 - 13:00」の独自の形のため、日付だけを読む処理を追加） |
| 米国 CDC MMWR（`tools.cdc.gov/api/v2/resources/media/342778.rss`） | 自動取得（**無効**。研究と対策、最大8件） | — | CDC の Use of Agency Materials（https://www.cdc.gov/other/agencymaterials.html）：大半はパブリックドメイン。出典の表示、推薦を示唆しない旨の目立つ表示、内容を変えない、無料で入手できる旨の表示が条件 | **使わない（2026-10-26）**：フィードの各項目のリンクが www.cdc.gov のページではなく、tools.cdc.gov の取得用URL（`?m=…&c=…` 付き）。このサイトのリンクの決まり（? を含めない・リンク先のホストを固定）に合わず、リンク先も確かめられないため |
| 使わない：厚生労働省・警察庁・内閣府の RSS | — | — | RSS の案内ページに「営利・非営利を問わず、その情報に基づいたホームページ・メールマガジンの作成、情報の再配布は固くお断り」（厚生労働省は https://www.mhlw.go.jp/rss で確認。2026-10-26） | 使用不可 |
| Natural Earth（国境・国名データ） | 同梱 | 地図の形（「日本から見た国境」版 ne_10m_admin_0_countries_jpn を scripts/prepare-geo.mjs で簡略化）、国名（日本語含む）、表示位置 | パブリックドメイン | 確認済み（取得元リポジトリの LICENSE） |
| d3-geo 3.1.1 / d3-array 3.2.4 | 同梱 | 地球儀の描画 | ISC ライセンス（`site/vendor/LICENSE-*.txt`） | 確認済み |
| 厚生労働省「まもろうよ こころ」 | リンクのみ | 相談窓口の案内 | リンクのみ | URL 確認済み（2026-10） |
| 気象庁「防災情報」・政府広報オンライン（#9110・188） | リンクのみ（防犯・防災・地震の案内） | 公式の防災情報・相談先の案内 | リンクのみ | 政府広報オンラインは確認済み（2026-10-26）。気象庁のページは自動取得できず、公式ドメインと気象庁のリンク集で確認。**運用者がブラウザで一度開いて確認すること** |

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
