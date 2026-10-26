# 運用手順（人間向け）

## ローカルで確認する

外部パッケージのインストールは不要です（Node.js 22 以上だけ必要）。

```bash
node scripts/test.mjs             # 自己テスト（ネット接続なし。悪意ある入力を落とせるかも確認）
node scripts/validate-data.mjs    # データ検査
node scripts/build.mjs --offline  # ネット接続なしで _site/ を作る（自動取得の分野は「未取得」）
node scripts/serve.mjs            # http://127.0.0.1:8080/ で確認（自分のPCからのみ接続可）
```

本番と同じ取得を試す場合は `node scripts/build.mjs`（WHO・CISA に接続します）。

## コミット前の自動検査（任意・おすすめ）

```bash
git config core.hooksPath .githooks
```

以後、コミットのたびに個人情報・秘密情報とデータ形式を検査し、問題があればコミットを止めます。

## 毎日の自動更新

- GitHub Actions が毎日 05:43 と 17:43（日本時間）に取得 → 検査 → 公開
- 失敗した日は公開されず、サイトは前回の内容のまま（画面下部と説明ページの日時が古いまま止まる）
- **注意**：公開リポジトリで60日間コミットが無いと、GitHub は定期実行を自動停止します。月1回の点検で手動データの `reviewedAt` を更新するなど、何らかのコミットを入れてください

## 自動更新が失敗したとき

1. Actions タブで失敗したジョブのログを見る
2. よくある原因
   - `HTTP 4xx/5xx`：取得先の一時的な不具合。翌日の実行を待つか、手動で再実行
   - `unexpected response shape`：取得先の形式変更。`scripts/fetch-*.mjs` の修正が必要
   - `too few items`：取得件数が異常に少ない。取得先の不具合の可能性。データを確認してから対処
   - 検査エラー：取得データに想定外の内容（HTML・不正URLなど）。安全側で止まっている状態なので、無理に通さない
3. 原因が分からない場合は、無理に直さずサイトを前回の内容のまま置いておく（それが安全な状態です）

## 手動データ（研究と対策・こころ・福祉）の追加

変更するのは `data/curated/entries.json` と `data/curated/changelog.json` の2ファイルだけ。国・分野別の公式リンク集 `data/directory/links.json` は運用者だけが更新する（URLは `scripts/allowed-sources.json` の `directoryHosts` に載っている機関のものだけ。ひらがな欄 `jaKana` に漢字が残っていると CI が止める）。手順の詳細は `ops/CURATION.md`、監査は `ops/AUDITS.md`。

1. AI 運用者または自分が作業ブランチで2ファイルを編集し、PR を作る
2. 監査担当（ops/ROLES.md）のレビューコメントを確認したうえで、運用者がレビューする。最低限ここを見る
   - 原典の URL を **自分で開き**、要約が原典と一致しているか
   - 原典が査読論文・公的機関・国際機関のどれかか
   - 断定・誇大・優劣の表現が無いか
   - 福祉は「〇〇によれば」の形になっているか
   - こころの分野に手段・方法の記述が無いか
   - PR の「不審な記述の報告」欄
3. 検査（validate）が通っていることを確認してマージ → 自動で公開

## 月1回の点検

- [ ] Actions の実行が毎日成功しているか
- [ ] Dependabot の PR（Actions の更新）を確認。変更内容を見てからマージ
- [ ] 手動データのリンク切れ・内容の古さ。見直したら `reviewedAt` を更新
- [ ] AI 運用者のトークンの有効期限
- [ ] `docs/SOURCES.md` の利用条件に変更が無いか（年1回でも可）

## 部品の更新

- 地図データ：`node scripts/prepare-geo.mjs <110m.geojson> <50m.geojson>`（Natural Earth のファイルを手元に置いて実行）
- d3-geo / d3-array：`site/vendor/` のファイルを差し替える。差し替え前後で SHA-256 を記録する

| ファイル | バージョン | SHA-256 |
|---------|-----------|---------|
| site/vendor/d3-geo.min.js | 3.1.1 | 23e574f1e8d4716d622bce45356a379b66a277162b145f5f147e4c8daefb73d2 |
| site/vendor/d3-array.min.js | 3.2.4 | 80aa70d0cd17dabddf6d056494ea17926a45a69da8b7850220aace331bad671d |

## 将来の多言語化

- 画面の文言は `site/i18n/ja.json`。言語を足すときは `en.json` などを追加し、`site/js/i18n.js` の `loadLanguage()` に切り替え UI をつなぐ
- データ側は `title` などが `{ "ja": "...", "en": "..." }` の形なので、言語別の文言を足せばよい
