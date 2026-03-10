# Daily Log Healthcare (Cloudflare Workers)

Notion の Daily Log / Supplements を Cloudflare Workers 経由で更新するプロジェクトです。

- Health Daily Upsert: `POST /api/health/daily`
- Meal Photos 連携: `POST /api/daily-log/meal-photos/run`
- Supplements 取得: `GET /api/supplements`
- Supplement Intake 作成: `POST /api/supplement_intakes`

---

## meal photos 処理の概要

`/api/daily-log/meal-photos/run` は次を行います。

1. 対象日（指定がなければ JST 前日）を決定
2. Dropbox の指定フォルダから画像を取得
3. 対象日の画像だけを抽出
4. Notion Daily Log ページを検索（なければ作成）
5. Dropbox 共有リンクを作成して Notion の `Meal Photos` に追記

---

## なぜ fixed access token ではなく refresh token 方式にするのか

Dropbox の **access token は期限切れ** になります。固定 token を環境変数に置いて使い続けると、`401 expired_access_token` で止まりやすくなります。

このプロジェクトでは以下に変更しています。

- 主経路: `DROPBOX_REFRESH_TOKEN` + `DROPBOX_CLIENT_ID` + `DROPBOX_CLIENT_SECRET` から都度 access token を取得
- フォールバック: `DROPBOX_ACCESS_TOKEN`（互換目的のみ。将来的に削除推奨）

---

## 環境変数一覧（Secrets / vars の分離）

### Secrets に置くもの（機密）

- `NOTION_TOKEN`
- `HEALTH_API_KEY`
- `DROPBOX_CLIENT_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `SUPPLEMENTS_DB_ID`
- `INTAKE_LOG_DB_ID`
- `HEALTH_DB_ID`

> `DROPBOX_CLIENT_ID` は公開されても致命傷ではないケースが多いですが、運用ポリシー上 Secret 扱いでも問題ありません。

### vars（`wrangler.toml`）に置けるもの（非機密）

- `HEALTH_DATE_PROP`
- `HEALTH_TITLE_PROP`
- `MEAL_PHOTOS_FOLDER_PATH`
- `DROPBOX_CLIENT_ID`（Secret 扱いにする場合は vars から削除）
- `TZ`（必要なら）

---

## Cloudflare Workers で Secret を設定する具体例

### 本番（`--env production`）

```bash
wrangler secret put NOTION_TOKEN --env production
wrangler secret put HEALTH_API_KEY --env production
wrangler secret put DROPBOX_CLIENT_SECRET --env production
wrangler secret put DROPBOX_REFRESH_TOKEN --env production
wrangler secret put SUPPLEMENTS_DB_ID --env production
wrangler secret put INTAKE_LOG_DB_ID --env production
wrangler secret put HEALTH_DB_ID --env production
```

### デフォルト環境

```bash
wrangler secret put NOTION_TOKEN
wrangler secret put HEALTH_API_KEY
wrangler secret put DROPBOX_CLIENT_SECRET
wrangler secret put DROPBOX_REFRESH_TOKEN
```

---

## ローカル開発の設定方法

Cloudflare Workers のローカル実行では `.dev.vars` が使えます。

1. ひな形をコピー

```bash
cp .dev.vars.example .dev.vars
```

2. `.dev.vars` に実値を設定（コミットしない）
3. 開発サーバ起動

```bash
npm run dev
```

---

## 本番 deploy 手順

1. `wrangler.toml` の vars を確認
2. 必要な Secret が Cloudflare 側に設定済みか確認
3. デプロイ

```bash
npm run deploy
```

> 重要: **deploy で Secret は自動投入されません**。Secret は `wrangler secret put` で別管理します。

---

## deploy 前後のチェック手順（設定事故防止）

### deploy 前

- `wrangler.toml` の vars が想定値か確認
- `DROPBOX_CLIENT_SECRET` / `DROPBOX_REFRESH_TOKEN` を Secret として設定済みか確認
- `MEAL_PHOTOS_FOLDER_PATH` が空文字でないことを確認

### deploy 後

- `/api/daily-log/meal-photos/run` を手動実行
- Workers Logs で以下ログが揃っているか確認
  - `MEAL_PHOTOS_START`
  - `DROPBOX_TOKEN_REFRESH_START` / `DROPBOX_TOKEN_REFRESH_END`
  - `DROPBOX_FETCH_START` / `DROPBOX_FETCH_END`
  - `NOTION_APPEND_START` / `NOTION_APPEND_END`
  - `MEAL_PHOTOS_DONE` または `MEAL_PHOTOS_ERROR`

---

## 401 `expired_access_token` が出たときの確認ポイント

1. `DROPBOX_REFRESH_TOKEN` が有効か
2. `DROPBOX_CLIENT_ID` / `DROPBOX_CLIENT_SECRET` の組み合わせが正しいか
3. Logs に `DROPBOX_API_UNAUTHORIZED` が出ていないか
4. レスポンス `error` / `code` が `dropbox_access_token_expired` になっていないか

---

## API 認証仕様

- Header: `Authorization: Bearer <HEALTH_API_KEY>`
- 不一致時: `401 Unauthorized`

---

## セキュリティ注意（必読）

- access token / refresh token / client secret を **コードに直書きしない**
- token, secret を **ログ出力しない**
- `.dev.vars` を **Git 管理しない**
- トラブル時も、ログに機密値全文を出さない（先頭数百文字の安全な範囲に限定）
