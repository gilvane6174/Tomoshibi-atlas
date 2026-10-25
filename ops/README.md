# 運用手順書（AI・bot・人間共通）

| ファイル | 内容 | 主な読み手 |
|---------|------|-----------|
| [../AGENTS.md](../AGENTS.md) | 最初に読む全体ルール | AI・bot |
| [INJECTION-DEFENSE.md](INJECTION-DEFENSE.md) | プロンプトインジェクション等への備え | AI・bot |
| [ROLES.md](ROLES.md) | 役割分担（掲載・監査4種）と権限 | AI・bot・運用者 |
| [SCHEDULE.md](SCHEDULE.md) | 作業時刻とアクセス回数の制限 | AI・bot・運用者 |
| [CURATION.md](CURATION.md) | 掲載作業の手順と書き方 | 掲載担当 |
| [AUDITS.md](AUDITS.md) | 監査（セキュリティ・情報・翻訳・偏り）の手順 | 監査担当 |
| [PRIVACY.md](PRIVACY.md) | 運用者・閲覧者の個人情報の扱い | 全員 |
| [LINK-SAFETY.md](LINK-SAFETY.md) | リンクの安全基準と週1回の自動確認 | 全員 |
| [INCIDENT.md](INCIDENT.md) | 緊急停止（ops/AI-PAUSE）と、乗っ取り・誤情報への対応 | 全員 |
| [../docs/SECURITY-DESIGN.md](../docs/SECURITY-DESIGN.md) | 安全設計と、参考にした実際の攻撃事例 | 運用者・監査担当 |
| [../docs/GITHUB-SETTINGS.md](../docs/GITHUB-SETTINGS.md) | GitHub 側で運用者が行う設定 | 運用者 |
| [../docs/OPERATIONS.md](../docs/OPERATIONS.md) | 日々の運用・トラブル時の対応 | 運用者 |

これらの手順書の変更は、運用者だけが行う（CODEOWNERS と CI の範囲検査で強制）。
