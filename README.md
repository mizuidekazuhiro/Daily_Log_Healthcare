# Daily Log Healthcare (Cloudflare Workers)

Notion の Daily Log / Supplements を Cloudflare Workers 経由で更新するプロジェクトです。

## できること

- Health Daily Upsert: `POST /api/health/daily`
  - 体重: `weight`
  - 栄養: `protein` / `fat` / `carb` / `kcal`
  - 既存入力元: `source`
  - 追加対応: 睡眠データ `sleep_start` / `sleep_end` / `sleep_duration_min` / `sleep_score` / `sleep_awakenings` / `in_bed_duration_min` / `sleep_source`
- Meal Photos 連携: `POST /api/daily-log/meal-photos/run`
- Supplements 取得: `GET /api/supplements`
- Supplement Intake 作成: `POST /api/supplement_intakes`

---

## 初心者向けセットアップ手順

### 1. 先に準備するもの

最低限、以下を用意してください。

- Cloudflare アカウント
- Notion アカウント
- Node.js
- npm
- Wrangler（Cloudflare Workers 用 CLI。通常は `npm install` で入ります）
- この ZIP を展開したローカル環境

### 2. ZIP を展開して依存関係を入れる

```bash
npm install
```

### 3. Notion 側で必要なデータベース列を作る

`/api/health/daily` で使う列名は **完全一致** で以下を用意してください。

#### 必須列

- `Name` : title
- `Date` : date

#### 既存ヘルス列

- `Weight` : number
- `Protein` : number
- `Fat` : number
- `Carb` : number
- `Kcal` : number
- `Source` : select

#### 今回追加した睡眠列

- `Sleep Start` : date
- `Sleep End` : date
- `Sleep Duration Min` : number
- `Sleep Score` : number
- `Sleep Awakenings` : number
- `In Bed Duration Min` : number
- `Sleep Source` : select

> `Sleep Source` には `autosleep` や `healthkit` など、使いたい候補を Notion 側で追加しておくと運用しやすいです。

### 4. Notion Integration を作成して Database と接続する

1. Notion の Integration を作成
2. Integration token を取得
3. Daily Log Database にその Integration を招待
4. Database ID を控える

### 5. Cloudflare Workers 用の設定値を用意する

このリポジトリでは、機密情報は Secret、機密でない値は `wrangler.toml` の vars で扱えます。

#### Secrets に置くもの

- `NOTION_TOKEN`
- `HEALTH_API_KEY`
- `DROPBOX_CLIENT_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `SUPPLEMENTS_DB_ID`
- `INTAKE_LOG_DB_ID`
- `HEALTH_DB_ID`

#### vars に置けるもの

- `HEALTH_DATE_PROP`
- `HEALTH_TITLE_PROP`
- `MEAL_PHOTOS_FOLDER_PATH`
- `DROPBOX_CLIENT_ID`
- `TZ`

### 6. Cloudflare に Secret を設定する

#### 本番環境

```bash
wrangler secret put NOTION_TOKEN --env production
wrangler secret put HEALTH_API_KEY --env production
wrangler secret put DROPBOX_CLIENT_SECRET --env production
wrangler secret put DROPBOX_REFRESH_TOKEN --env production
wrangler secret put SUPPLEMENTS_DB_ID --env production
wrangler secret put INTAKE_LOG_DB_ID --env production
wrangler secret put HEALTH_DB_ID --env production
```

#### デフォルト環境

```bash
wrangler secret put NOTION_TOKEN
wrangler secret put HEALTH_API_KEY
wrangler secret put DROPBOX_CLIENT_SECRET
wrangler secret put DROPBOX_REFRESH_TOKEN
```

### 7. ローカルで試す

Cloudflare Workers のローカル実行では `.dev.vars` が使えます。

1. 必要なら `.dev.vars` を作成
2. 実際の Secret 値を入れる
3. 開発サーバを起動

```bash
npm run dev
```

### 8. デプロイする

```bash
npm run deploy
```

> 重要: Secret は `deploy` では自動登録されません。必ず `wrangler secret put` を別途実行してください。

---

## `/api/health/daily` の仕様

### 認証

- Header: `Authorization: Bearer <HEALTH_API_KEY>`
- 不一致時: `401 Unauthorized`

### 挙動

- `Date` をキーに Notion の既存ページを検索
- 既存ページがあれば PATCH
- なければ CREATE
- `null` / `undefined` / 空文字の項目は Notion に書き込まない
- 既存の `weight` / `protein` / `fat` / `carb` / `kcal` / `source` の挙動は維持
- 新たに睡眠データを書き込める

### 送信できる JSON 例

```json
{
  "date": "2026-03-21",
  "weight": 70.2,
  "sleep_start": "2026-03-20T23:48:00+09:00",
  "sleep_end": "2026-03-21T06:32:00+09:00",
  "sleep_duration_min": 404,
  "sleep_score": 82,
  "sleep_awakenings": 2,
  "in_bed_duration_min": 430,
  "sleep_source": "autosleep",
  "source": "healthkit"
}
```

### curl 例

```bash
curl -X POST "https://<your-worker-domain>/api/health/daily" \
  -H "Authorization: Bearer <HEALTH_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-03-21",
    "weight": 70.2,
    "sleep_start": "2026-03-20T23:48:00+09:00",
    "sleep_end": "2026-03-21T06:32:00+09:00",
    "sleep_duration_min": 404,
    "sleep_score": 82,
    "sleep_awakenings": 2,
    "in_bed_duration_min": 430,
    "sleep_source": "autosleep",
    "source": "healthkit"
  }'
```

---

## iPhone ショートカットで送る方法

iPhone の「ショートカット」アプリから、この Worker にヘルスデータを送れるようにできます。

### 一番簡単な作り方

1. iPhone で **ショートカット** アプリを開く
2. 新規ショートカットを作成
3. 変数や辞書を使って JSON を組み立てる
4. `URL の内容を取得` アクションで Worker に POST する

### 推奨する JSON の中身

辞書またはテキストで以下のような JSON を作ります。

```json
{
  "date": "2026-03-21",
  "weight": 70.2,
  "protein": 120,
  "fat": 50,
  "carb": 200,
  "kcal": 1800,
  "sleep_start": "2026-03-20T23:48:00+09:00",
  "sleep_end": "2026-03-21T06:32:00+09:00",
  "sleep_duration_min": 404,
  "sleep_score": 82,
  "sleep_awakenings": 2,
  "in_bed_duration_min": 430,
  "sleep_source": "autosleep",
  "source": "healthkit"
}
```

### `URL の内容を取得` の設定例

- URL: `https://<your-worker-domain>/api/health/daily`
- 方法: `POST`
- Headers:
  - `Authorization` = `Bearer <HEALTH_API_KEY>`
  - `Content-Type` = `application/json`
- Request Body: 上の JSON

### ショートカット作成のコツ

- 空欄を送りたい項目は空文字でも構いません。この Worker 側で `null` 相当として扱います。
- 数字項目は文字列で来ても、可能なら number に正規化されます。
- 日付は `2026-03-20T23:48:00+09:00` のような ISO 8601 形式を推奨します。
- `sleep_source` には `autosleep`、`source` には `healthkit` のように分けると、睡眠元と全体入力元を Notion 上で分けて管理できます。

---

## meal photos 処理の概要

`/api/daily-log/meal-photos/run` は次を行います。

1. 対象日（指定がなければ JST 前日）を決定
2. Dropbox の指定フォルダから画像を取得
3. 対象日の画像だけを抽出
4. Notion Daily Log ページを検索（なければ作成）
5. Dropbox 共有リンクを作成して Notion の `Meal Photos` に追記（重複判定は Dropbox file id を優先し、次に path_lower 正規化で判定）

---

## なぜ fixed access token ではなく refresh token 方式にするのか

Dropbox の **access token は期限切れ** になります。固定 token を環境変数に置いて使い続けると、`401 expired_access_token` で止まりやすくなります。

このプロジェクトでは以下に変更しています。

- 主経路: `DROPBOX_REFRESH_TOKEN` + `DROPBOX_CLIENT_ID` + `DROPBOX_CLIENT_SECRET` から都度 access token を取得
- フォールバック: `DROPBOX_ACCESS_TOKEN`（互換目的のみ。将来的に削除推奨）

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

## セキュリティ注意

- access token / refresh token / client secret を **コードに直書きしない**
- token, secret を **ログ出力しない**
- `.dev.vars` を **Git 管理しない**
- トラブル時も、ログに機密値全文を出さない
