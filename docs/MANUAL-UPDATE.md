# 手動で更新するときの手引き（どのファイルを触ればよいか）

手動で変えるデータは、すべて `data/` の中にある。**画面のプログラム（`site/`）や検査のプログラム（`scripts/`）は触らなくてよい。**
変えた後は `node scripts/validate-data.mjs` で検査し、OK になってから PR にする（PR でも同じ検査が必ず走る）。

| やりたいこと | 触るファイル | 誰が変えられるか | 注意 |
|---|---|---|---|
| 研究と対策・こころと福祉・防犯・防災に、情報を1件足す／直す／外す | `data/curated/entries.json` と `data/curated/changelog.json`（**2つ一組**） | 運用者・AI（AI は `curated/` ブランチの PR だけ） | 書き方は `ops/CURATION.md`。同じ原典の URL は2件載せられない。外すときも更新履歴に id を書く |
| 週ごとの候補をまとめて足す | 候補のファイル → `node scripts/add-candidates.mjs 候補.json --write --by ai-curator` | 運用者・AI | 2つのファイルを一組で検査してから書き込む（失敗したら元に戻る） |
| 「情報のつながりを見る」のテーマ | `data/curated/connections.json` | 運用者だけ | 掲載中の項目の id だけ。因果関係を書かない |
| 今日の動物たちの豆知識 | `data/curated/animals.json` | 運用者だけ | 悲しい・怖い話につながる言葉は検査で止まる |
| 国ごとの相談先・公式リンク | `data/directory/links.json` と `data/directory/evidence.json`（確認の記録） | 運用者だけ | 確認の記録が無いリンクは公開されない |
| 都道府県・市区町村・社会福祉協議会の福祉のページ | `data/directory/prefectures.json` と `data/directory/evidence.json` | 運用者だけ | 都道府県は `links`（最大3件）、市区町村・社会福祉協議会は `local`。新しいドメインは `scripts/allowed-sources.json` の `directoryHosts` にも足す（安全設計の変更なので、PR の本文に「安全設計の変更を確認済み」） |
| 自動取得の情報（感染症・ITセキュリティ・地震・新着の見出し・世界をくらべるの統計） | なし（公開のたびに自動で取得） | — | 取得先を変えるときは `scripts/allowed-sources.json`（運用者だけ） |

## なぜファイルを分野ごとに分けていないか

AI・bot が変えてよいファイルを `entries.json` と `changelog.json` の2つに絞り、範囲の検査（`scripts/check-pr-scope.mjs`・`scope-guard`）で機械的に止めているため。
分野ごとのファイルに分けると、検査の対象と、main 側の検査プログラムを同時に変える必要がある（2段階の取り込みが必要）。
分けたい場合は、運用者の判断で、別の回に「段階1：検査の更新／段階2：ファイルの分割」として行う。

## 自動取得と手動の関係

- 自動取得の情報は保存しない（公開のたびに取り直す）。手動の情報は `entries.json` に残り、表示から外れた後も「過去の記録の一覧」で見られる
- 自動取得は日本時間の 0:07・6:07・18:07（GitHub の都合で遅れることがある）。手動の更新は、PR を取り込むと次の公開で反映される
