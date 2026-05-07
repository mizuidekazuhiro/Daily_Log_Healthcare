# Daily Log Healthcare (Cloudflare Workers)

Notion の Daily Log / Supplements を Cloudflare Workers 経由で更新するプロジェクトです。

## できること

- Health Daily Upsert: `POST /api/health/daily`
  - 体重: `weight`
  - 栄養: `protein` / `fat` / `carb` / `kcal`
  - 既存入力元: `source`
  - 既存睡眠項目: `sleep_start` / `sleep_end` / `sleep_duration_min` / `sleep_score` / `sleep_awakenings` / `in_bed_duration_min` / `sleep_source`
  - 新規任意項目: `rem_duration_min` / `deep_duration_min` / `sleep_heart_rate` / `readiness_stars` / `readiness_hrv` / `readiness_bpm` / `baseline_hrv` / `baseline_waking_bpm` / `sleep_percent` / `rem_percent` / `deep_percent` / `heart_rate_percent` / `readiness_label`
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

`/api/health/daily` で使う列名は **完全一致** で以下を用意してください。既存クライアントとの後方互換性は維持されており、新規追加項目はすべて任意です。値が存在するものだけ保存され、欠けている項目・空文字・`null`・`undefined`・parse 不能な数値はその項目だけスキップされます。

### 推奨Notion列一覧

#### 必須列

| 区分 | Notion列名 | 型 | APIキー | 備考 |
| --- | --- | --- | --- | --- |
| 必須 | `Name` | title | なし | 自動で `Daily Log | YYYY-MM-DD` を設定 |
| 必須 | `Date` | date | `date` | upsert の検索キー |

#### 既存列

| 区分 | Notion列名 | 型 | APIキー | 備考 |
| --- | --- | --- | --- | --- |
| 既存 | `Weight` | number | `weight` | 任意 |
| 既存 | `Protein` | number | `protein` | 任意 |
| 既存 | `Fat` | number | `fat` | 任意 |
| 既存 | `Carb` | number | `carb` | 任意 |
| 既存 | `Kcal` | number | `kcal` | 任意 |
| 既存 | `Source` | select | `source` | 任意 |
| 既存 | `Sleep Start` | date | `sleep_start` | ISO 8601 必須 |
| 既存 | `Sleep End` | date | `sleep_end` | ISO 8601 必須 |
| 既存 | `Sleep Duration Min` | number | `sleep_duration_min` | 任意 |
| 既存 | `Sleep Score` | number | `sleep_score` | 任意 |
| 既存 | `Sleep Awakenings` | number | `sleep_awakenings` | 任意 |
| 既存 | `In Bed Duration Min` | number | `in_bed_duration_min` | 任意 |
| 既存 | `Sleep Source` | select | `sleep_source` | 任意 |

#### 新規列

| 区分 | Notion列名 | 型 | APIキー | 備考 |
| --- | --- | --- | --- | --- |
| 新規 | `REM Duration Min` | number | `rem_duration_min` | AutoSleep / Shortcuts 側で分換算して送信 |
| 新規 | `Deep Duration Min` | number | `deep_duration_min` | AutoSleep / Shortcuts 側で分換算して送信 |
| 新規 | `Sleep Heart Rate` | number | `sleep_heart_rate` | 任意 |
| 新規 | `Readiness Stars` | number | `readiness_stars` | 任意 |
| 新規 | `Readiness HRV` | number | `readiness_hrv` | 任意 |
| 新規 | `Readiness BPM` | number | `readiness_bpm` | 任意 |
| 新規 | `Baseline HRV` | number | `baseline_hrv` | 任意 |
| 新規 | `Baseline Waking BPM` | number | `baseline_waking_bpm` | 任意 |
| 新規 | `Sleep Percent` | number | `sleep_percent` | 任意。Notion では Number + Percent 表示を推奨。API で 135 を受けると保存時に 1.35 へ変換 |
| 新規 | `REM Percent` | number | `rem_percent` | 任意。Notion では Number + Percent 表示を推奨。API で 204 を受けると保存時に 2.04 へ変換 |
| 新規 | `Deep Percent` | number | `deep_percent` | 任意。Notion では Number + Percent 表示を推奨。API で 110 を受けると保存時に 1.10 へ変換 |
| 新規 | `Heart Rate Percent` | number | `heart_rate_percent` | 任意。Notion では Number + Percent 表示を推奨。API で 153 を受けると保存時に 1.53 へ変換 |
| 新規 | `Readiness Label` | rich_text | `readiness_label` | 任意。APIでは string を受け取り、Worker が rich_text に変換して保存 |

> `Sleep Source` は select 型、`Readiness Label` は rich_text 型で作成してください。`readiness_label` は API では string で受け取り、Worker が Notion の rich_text 配列へ変換して保存します。

### Notion 列追加手順

1. 既存の Daily Log Database を開く
2. 上の「推奨Notion列一覧」に従って不足列を追加する
3. Number 型の列は数値、Date 型の列は日付、Select 型の列は候補を追加し、`Readiness Label` は rich_text 型で作成する
4. `Sleep Percent` / `REM Percent` / `Deep Percent` / `Heart Rate Percent` は Notion 側で **Number + Percent 表示** にすることを推奨
5. `sleep_start` / `sleep_end` を使う場合は ISO 8601 文字列を送る
6. 新規項目を送らない既存クライアントでも、既存列だけで従来どおり保存できる

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
- `DAILY_LOG_DATE_PROP`
- `DAILY_LOG_TITLE_PROP`
- `DAILY_LOG_MEAL_PHOTOS_PROP`
- `DAILY_LOG_SOURCE_PROP`
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
- 既存ページがあれば PATCH、なければ CREATE
- `null` / `undefined` / 空文字の項目は Notion に書き込まない
- 数値項目が未送信、`null`、`undefined`、空文字、parse 不能な場合はその項目だけを無視して全体処理は継続する
- `sleep_percent` / `rem_percent` / `deep_percent` / `heart_rate_percent` は API では 135 のような値を受け取り、Notion 保存直前に `/100` して Number プロパティへ保存する
- 追加項目はすべて任意で、欠けていても 4xx にしない
- 受信 payload に含まれている値だけを保存し、欠けている値は単にスキップする
- `readiness_label` は空でない場合のみ `Readiness Label` に `{ rich_text: [{ type: "text", text: { content } }] }` 形式で保存する
- 既存の `weight` / `protein` / `fat` / `carb` / `kcal` / `source` / 睡眠項目の挙動は維持する
- `sleep_start` / `sleep_end` は既存仕様どおり ISO 8601 を要求する

### APIキー → Notionプロパティ対応

| APIキー | Notionプロパティ | 型 | 任意/必須 |
| --- | --- | --- | --- |
| `date` | `Date` | date | 必須 |
| `weight` | `Weight` | number | 任意 |
| `protein` | `Protein` | number | 任意 |
| `fat` | `Fat` | number | 任意 |
| `carb` | `Carb` | number | 任意 |
| `kcal` | `Kcal` | number | 任意 |
| `source` | `Source` | select | 任意 |
| `sleep_start` | `Sleep Start` | date | 任意（送る場合は ISO 8601） |
| `sleep_end` | `Sleep End` | date | 任意（送る場合は ISO 8601） |
| `sleep_duration_min` | `Sleep Duration Min` | number | 任意 |
| `sleep_score` | `Sleep Score` | number | 任意 |
| `sleep_awakenings` | `Sleep Awakenings` | number | 任意 |
| `in_bed_duration_min` | `In Bed Duration Min` | number | 任意 |
| `sleep_source` | `Sleep Source` | select | 任意 |
| `rem_duration_min` | `REM Duration Min` | number | 任意 |
| `deep_duration_min` | `Deep Duration Min` | number | 任意 |
| `sleep_heart_rate` | `Sleep Heart Rate` | number | 任意 |
| `readiness_stars` | `Readiness Stars` | number | 任意 |
| `readiness_hrv` | `Readiness HRV` | number | 任意 |
| `readiness_bpm` | `Readiness BPM` | number | 任意 |
| `baseline_hrv` | `Baseline HRV` | number | 任意 |
| `baseline_waking_bpm` | `Baseline Waking BPM` | number | 任意 |
| `sleep_percent` | `Sleep Percent` | number | 任意（API で 135 を受けたら保存時は 1.35） |
| `rem_percent` | `REM Percent` | number | 任意（API で 204 を受けたら保存時は 2.04） |
| `deep_percent` | `Deep Percent` | number | 任意（API で 110 を受けたら保存時は 1.10） |
| `heart_rate_percent` | `Heart Rate Percent` | number | 任意（API で 153 を受けたら保存時は 1.53） |
| `readiness_label` | `Readiness Label` | rich_text | 任意（stringで受け取り、内部で rich_text に変換） |

### 送信JSON例（フル）

```json
{
  "date": "2026-03-21",
  "weight": 70.2,
  "sleep_start": "2026-03-20T22:53:00+09:00",
  "sleep_end": "2026-03-21T08:33:00+09:00",
  "sleep_duration_min": 585,
  "sleep_score": 100,
  "sleep_source": "autosleep",
  "rem_duration_min": 165,
  "deep_duration_min": 75,
  "sleep_heart_rate": 71,
  "readiness_stars": 3,
  "readiness_hrv": 39,
  "readiness_bpm": 69,
  "baseline_hrv": 39,
  "baseline_waking_bpm": 69,
  "sleep_percent": 135,
  "rem_percent": 204,
  "deep_percent": 110,
  "heart_rate_percent": 153,
  "readiness_label": "OK"
}
```

### %項目の保存時変換

`Sleep Percent` / `REM Percent` / `Deep Percent` / `Heart Rate Percent` は Notion では **Number プロパティ** として保存し、表示形式は **Percent** を推奨します。API では従来どおり 135 のような整数値または数値文字列を受け取り、Worker が Notion 保存直前に `/100` して保存します。

送信JSON:

```json
{
  "sleep_percent": 135,
  "rem_percent": 204,
  "deep_percent": 110,
  "heart_rate_percent": 153
}
```

Notion 保存値:

- `Sleep Percent`: `1.35`
- `REM Percent`: `2.04`
- `Deep Percent`: `1.10`
- `Heart Rate Percent`: `1.53`

Notion 側で Percent 表示にすると、`135%` / `204%` / `110%` / `153%` のように表示できます。


### 送信JSON例（部分送信）

```json
{
  "date": "2026-03-21",
  "sleep_duration_min": 585,
  "sleep_source": "autosleep",
  "sleep_score": 100
}
```

> 追加項目の一部しか無くても成功します。追加項目を一切送らない既存クライアントも従来どおり成功します。

> `%` 系4項目が未送信でもリクエスト全体は成功します。空文字・`null`・`undefined`・parse 不能な値はその項目だけをスキップし、保存可能な項目だけで処理を継続します。

### curl 例

```bash
curl -X POST "https://<your-worker-domain>/api/health/daily" \
  -H "Authorization: Bearer <HEALTH_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-03-21",
    "weight": 70.2,
    "sleep_start": "2026-03-20T22:53:00+09:00",
    "sleep_end": "2026-03-21T08:33:00+09:00",
    "sleep_duration_min": 585,
    "sleep_score": 100,
    "sleep_source": "autosleep",
    "rem_duration_min": 165,
    "deep_duration_min": 75,
    "sleep_heart_rate": 71,
    "readiness_stars": 3,
    "readiness_hrv": 39,
    "readiness_bpm": 69,
    "baseline_hrv": 39,
    "baseline_waking_bpm": 69,
    "sleep_percent": 135,
    "rem_percent": 204,
    "deep_percent": 110,
    "heart_rate_percent": 153,
    "readiness_label": "OK"
  }'
```

### 想定動作

- 追加項目なし: 成功
- 追加項目一部あり: 成功
- 追加項目全部あり: 成功
- 追加項目の一部が空 / `null`: その項目を無視して成功

---

## iPhone ショートカットで送る方法

iPhone の「ショートカット」アプリから、この Worker にヘルスデータを送れるようにできます。

### 一番簡単な作り方

1. iPhone で **ショートカット** アプリを開く
2. 新規ショートカットを作成
3. 変数や辞書を使って JSON を組み立てる
4. `URL の内容を取得` アクションで Worker に POST する

### 推奨する JSON の中身

辞書またはテキストで以下のような JSON を作ります。`rem_duration_min` と `deep_duration_min` は AutoSleep / Shortcuts 側で「分」に換算して送る想定です。

```json
{
  "date": "2026-03-21",
  "weight": 70.2,
  "protein": 120,
  "fat": 50,
  "carb": 200,
  "kcal": 1800,
  "sleep_start": "2026-03-20T22:53:00+09:00",
  "sleep_end": "2026-03-21T08:33:00+09:00",
  "sleep_duration_min": 585,
  "sleep_score": 100,
  "sleep_awakenings": 2,
  "in_bed_duration_min": 430,
  "sleep_source": "autosleep",
  "rem_duration_min": 165,
  "deep_duration_min": 75,
  "sleep_heart_rate": 71,
  "readiness_stars": 3,
  "readiness_hrv": 39,
  "readiness_bpm": 69,
  "baseline_hrv": 39,
  "baseline_waking_bpm": 69,
  "sleep_percent": 135,
  "rem_percent": 204,
  "deep_percent": 110,
  "heart_rate_percent": 153,
  "readiness_label": "OK",
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


## Migration note (for developers)

- `/api/health/daily` は新規追加の sleep/readiness 項目を optional として受け付けます。
- 既存クライアントは payload を変更しなくてもそのまま利用できます。
- Notion 側では `REM Duration Min` から `Readiness Label` までの新規列を追加してください。特に `Readiness Label` は rich_text 型で作成してください。
- 数値の追加項目は parse 不能でもリクエスト全体は失敗せず、その項目だけスキップされます。
- `sleep_start` / `sleep_end` は従来どおり ISO 8601 が必要です。

## 変更ファイルの一覧と変更理由

- `workers/src/services/legacy_health_daily_service.ts`: `/api/health/daily` の optional 項目追加、正規化、バリデーション、Notion プロパティ構築を更新。
- `tests/legacy_health_daily_service.test.mjs`: 追加項目なし / 一部あり / 全部あり / 空や parse 不可を含むケースの検証を追加。
- `README.md`: API キー対応表、JSON 例、Notion 列追加手順、migration note を追記。

## App usage study-time logging from iOS Shortcuts

- Endpoint: `POST /api/app-usage/session`
- Auth: `Authorization: Bearer <HEALTH_API_KEY>`
- New secret: `APP_USAGE_DB_ID`

### Required App Usage Sessions DB columns
- `Name` (title)
- `App` (select)
- `Start At` (date)
- `End At` (date)
- `Duration Min` (number)
- `Target Date` (date)
- `Device` (rich_text)
- `Source` (select)
- `Session ID` (rich_text)

### Required Daily Log columns
- `Study Minutes` (number)
- `Study Sessions` (number)
- `Study Last Used At` (date)

Example JSON:
```json
{
  "app": "Itojuku",
  "session_id": "anki-ios-20260506-132500",
  "started_at": "2026-05-06T13:25:00+09:00",
  "ended_at": "2026-05-06T14:05:00+09:00",
  "duration_seconds": 2400,
  "source": "ios_shortcuts",
  "device": "iPhone",
  "day_start_hour": 3
}
```

Example curl:
```bash
curl -X POST "https://<your-worker-domain>/api/app-usage/session" \
  -H "Authorization: Bearer <HEALTH_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "app": "Anki",
    "session_id": "anki-ios-manual-test-20260506-001",
    "started_at": "2026-05-06T13:25:00+09:00",
    "ended_at": "2026-05-06T14:05:00+09:00",
    "duration_seconds": 2400,
    "source": "ios_shortcuts",
    "device": "iPhone",
    "day_start_hour": 3
  }'
```

- This records app foreground time between open and close, not exact study quality.

- This feature tracks bar exam study time across multiple apps/sites.
- `/api/app-usage/session` accepts any non-empty app/site name (max 100 chars, control chars are rejected).
- App Usage Sessions DB (`APP_USAGE_DB_ID`) stores each individual session.
- Daily_Log DB (`DAILY_LOG_DB_ID`) receives total study aggregates at 03:00 JST.
- Manual aggregation endpoint: `POST /api/app-usage/aggregate` can aggregate a specific target date.
- iPhone Shortcuts should call this Worker, not Notion API directly.
- Notion token remains only in Cloudflare Worker secrets.

## Study App Usage 集計

- `POST /api/app-usage/session` は **App Usage Sessions DB (`APP_USAGE_DB_ID`) に個別セッションを記録するだけ** です。
- 10秒未満のセッションは無視されます。
- `Duration Min` は整数ではなく **小数分（小数点以下2桁）** で保存されます。
- このPOSTでは Daily_Log DB の更新は行いません（`daily_log_updated: false`）。
- Daily_Log への集計反映（`Study Minutes` / `Study Sessions` / `Study Last Used At`）は Cloudflare Cron により **毎日 03:00 JST** に実行されます。
- Cloudflare Cron は UTC 基準のため、03:00 JST は `0 18 * * *` です。
- `DAILY_LOG_DB_ID` は Daily_Log DB 用です。
- `HEALTH_DB_ID` は Health condition DB 用であり、study集計には使用しません。
- `APP_USAGE_DAILY_LOG_DB_ID` は不要です。
- 手動リカバリ用エンドポイント: `POST /api/app-usage/aggregate`（通常のiPhone Shortcutsからは呼ばない）。


## Voice Diary Notes API

### エンドポイント
- `POST /api/voice-diary/note`
- 認証: `Authorization: Bearer <HEALTH_API_KEY>`

### 用途
- iPhoneショートカットの音声入力メモを Notion の **Voice Diary Notes DB** に 1メモ=1ページで保存します。
- 当日 Daily Log ページ未作成の可能性を考慮し、このAPIでは **Daily Log DBは更新しません**。

### 必須環境変数
- `VOICE_DIARY_NOTES_DB_ID`（例: `788ff2d3-f4f7-44bc-9f99-db301250efae`）

### 受信JSON
```json
{
  "text": "夕方に集中力が落ちた。昼食後の眠気が強かった。",
  "recorded_at": "2026-05-07T18:10:00+09:00",
  "source": "ios_shortcut_voice",
  "target_date": "2026-05-07",
  "day_start_hour": 3
}
```

### バリデーション/補完
- `text`: 必須、trim後空文字NG、最大2000文字
- `recorded_at`: 未指定ならサーバ側でJST現在時刻を補完。指定時はISO 8601 datetime必須
- `target_date`: 未指定なら `recorded_at` と `day_start_hour`（default 3）からJST基準で算出
- `day_start_hour=3` の場合、JST 00:00〜02:59 は前日扱い
- `source`: 未指定なら `ios_shortcut_voice`、制御文字NG
- `note_hash`: `target_date + recorded_at + normalized_text` から sha256
- 注意: `recorded_at` を未指定にしてサーバ補完すると、再送のたびに時刻が変わり同文でも別ハッシュになります。ショートカット側で `recorded_at` を1回生成して送ることを推奨します。

### 重複判定
- 同一 `Note Hash` が既存なら新規作成せず `200` を返します（`deduped: true`）。
- 新規作成時は `Status = new`。

### レスポンス例
```json
{
  "ok": true,
  "created": true,
  "deduped": false,
  "target_date": "2026-05-07",
  "recorded_at": "2026-05-07T18:10:00+09:00",
  "note_hash": "..."
}
```

### iPhoneショートカット作成手順（最小）
1. 「音声をテキスト化」で本文を作る
2. JSONを組み立てる（`text`, `recorded_at`, `source`, `target_date`, `day_start_hour`）
3. 「URLの内容を取得」で `POST /api/voice-diary/note` を呼ぶ
4. Headerに `Authorization: Bearer <HEALTH_API_KEY>` と `Content-Type: application/json` を設定
5. 結果JSONの `ok` と `deduped` を通知表示


### Meal Photos 用 Notion プロパティ名の設定

Meal Photos 連携 (`/api/daily-log/meal-photos/run`) では Notion の列名を固定せず、以下の優先順位で解決します。

- DB ID: `DAILY_LOG_DB_ID` → `HEALTH_DB_ID`
- Date: `DAILY_LOG_DATE_PROP` → `HEALTH_DATE_PROP` → `Date`
- Title: `DAILY_LOG_TITLE_PROP` → `HEALTH_TITLE_PROP` → `Name`
- Meal Photos: `DAILY_LOG_MEAL_PHOTOS_PROP` → `Meal Photos`
- Source: `DAILY_LOG_SOURCE_PROP` → `Source`

`HEALTH_TITLE_PROP = "Name"` は互換用デフォルトです。Notion 側の title 列名が `Name` でない場合は、`DAILY_LOG_TITLE_PROP` か `HEALTH_TITLE_PROP` を実際の列名に必ず合わせてください。
