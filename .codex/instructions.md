# Codex 恒久指示（Daily_Log_Healthcare）

- PR本文・Issue本文・レビューコメントは日本語で書く。
- Notion API の `validation_error` は、まず DB プロパティ名・型・環境変数名の不一致を疑う。
- Notionプロパティ型（title / rich_text / number / date / checkbox / select / multi_select / url / email / phone_number / formula / rollup）差異に注意。
- `xxx is not a property that exists` はコード側のプロパティ名と Notion DB 側の列名不一致を優先確認。
- `expected to be rich_text` / `should be a valid ISO 8601 date string` は値型・空値処理・日付形式を確認。
- Cloudflare Workers の Secrets / Vars は既存 README・既存コード・既存 workflow を優先して判断。
- 環境変数名は勝手に変更しない。
- 新しい必須環境変数を増やす場合、README / `.env.example` / GitHub Actions 設定例を更新。
- 外部副作用（本番デプロイ、Notion書き込み、メール送信等）を CI 内で勝手に実行しない。
- メール送信処理は重複送信防止を常に意識。
- 日付処理は JST 基準が多いため UTC/JST 変換に注意。
- 修正は小さくテスト可能にし、既存テストは必ず実行。
- テストがない箇所は最小限の回帰テスト追加を検討。
