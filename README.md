# Daily Log Healthcare (Notion ⇄ Cloudflare Workers)

iPhoneショートカットやGitHub Actionsから Cloudflare Workers API を呼び、Notion の Daily Health / Supplement Intake を更新するリポジトリです。

- Health Daily Upsert: `POST /api/health/daily`
- Meal Photos 連携: `POST /api/daily-log/meal-photos/run`
- Supplements 取得: `GET /api/supplements`
- Supplement Intake 作成: `POST /api/supplement_intakes`

---

## 1. セットアップ全体像

1. Notion DB を準備（Daily Health / Supplements / Supplement Intake Log）
2. Cloudflare Workers に `wrangler deploy` でデプロイ
3. Workers Runtime Secrets を `wrangler secret put` で投入
4. iPhoneショートカット / GitHub Actions から API 呼び出し

---

## 2. Secrets / Vars の配置方針（結論先出し）

### A. どこに何を置くか

- **Cloudflare Workers Runtime で参照する値は Cloudflare 側に置く**
  - `NOTION_TOKEN`, `HEALTH_API_KEY`, 各 DB ID は Workers の Secrets
- **GitHub Actions には原則「実行基盤の認証」だけを置く**
  - 例: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- `NOTION_TOKEN` や `HEALTH_API_KEY` を GitHub Secrets に複製する方式は、
  - 漏洩面のリスク増
  - 値の二重管理による運用ミス
  につながるため、**デプロイ用途では非推奨**

> 例外: このリポジトリの `daily-log-meal-photos` workflow は「APIクライアント」として Workers を叩くため、`HEALTH_API_KEY` を GitHub Secrets に持たせる運用も可能です（最小権限・ローテーション推奨）。

### B. 具体的な設定先（このリポジトリ向け）

| 区分 | 置く場所 | キー |
|---|---|---|
| Deploy 実行用 | GitHub Secrets（Actions） | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`（必要に応じ `CLOUDFLARE_PROJECT_NAME`） |
| Meal Photos 呼び出し用 | GitHub Secrets（Actions） | `MEAL_PHOTOS_ENDPOINT`, `HEALTH_API_KEY` |
| Runtime 機密情報 | Cloudflare Workers Secrets | `NOTION_TOKEN`, `HEALTH_API_KEY`, `SUPPLEMENTS_DB_ID`, `INTAKE_LOG_DB_ID`, `HEALTH_DB_ID` |
| Runtime 非機密設定 | `wrangler.toml` の `vars` | `HEALTH_DATE_PROP`, `HEALTH_TITLE_PROP` |

### C. 「デプロイで値が消える」事故を防ぐ運用（最重要）

原因例:
- ダッシュボード手入力と CI/CD の設定がずれる
- 別環境へのデプロイで想定外の値になる

対策（Source of Truth を wrangler に統一）:
1. **Secrets は `wrangler secret put` で投入する**
2. **Vars は `wrangler.toml` で管理する**
3. ダッシュボード手入力を常用しない（緊急時のみ）

### Secrets 初期投入コマンド

```bash
wrangler secret put NOTION_TOKEN
wrangler secret put HEALTH_API_KEY
wrangler secret put SUPPLEMENTS_DB_ID
wrangler secret put INTAKE_LOG_DB_ID
wrangler secret put HEALTH_DB_ID
```

環境分離する場合（例: production）:

```bash
wrangler secret put NOTION_TOKEN --env production
wrangler secret put HEALTH_API_KEY --env production
wrangler secret put SUPPLEMENTS_DB_ID --env production
wrangler secret put INTAKE_LOG_DB_ID --env production
wrangler secret put HEALTH_DB_ID --env production
```

---

## 3. デプロイ

- `wrangler.toml` はこのリポジトリに同梱済み
- デプロイ:

```bash
npm run deploy
```

内部では `wrangler deploy` を実行します。

---

## 4. Cloudflare Workers 環境変数

### Secrets（機密）

- `NOTION_TOKEN`
- `HEALTH_API_KEY`
- `SUPPLEMENTS_DB_ID`
- `INTAKE_LOG_DB_ID`
- `HEALTH_DB_ID`

### Vars（非機密）

- `HEALTH_DATE_PROP`（省略時デフォルト: `Date`）
- `HEALTH_TITLE_PROP`（省略時デフォルト: `Name`）

---

## 5. 認証仕様（統一）

このリポジトリのヘルス系 API はすべて以下で認証します。

- Header: `Authorization: Bearer <HEALTH_API_KEY>`
- 検証: `token === env.HEALTH_API_KEY`
- 不一致時: `401 Unauthorized`

---

## 6. API 仕様

### POST `/api/health/daily`

- 認証: `Authorization: Bearer <HEALTH_API_KEY>`
- 必須: `date` (`YYYY-MM-DD`)
- 送信されたキーのみ更新（`null/undefined` は上書きしない）

```bash
export HEALTH_API_KEY="your-api-key"
curl -X POST "https://<worker>.workers.dev/api/health/daily" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $HEALTH_API_KEY" \
  -d '{
    "date":"2026-01-25",
    "weight":71.2,
    "protein":120,
    "fat":60,
    "carb":220,
    "kcal":2100,
    "source":"healthcare kit"
  }'
```

### POST `/api/daily-log/meal-photos/run`

- 認証: `Authorization: Bearer <HEALTH_API_KEY>`
- body は `{}` でも実行可能

```bash
curl -X POST "https://<worker>.workers.dev/api/daily-log/meal-photos/run" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $HEALTH_API_KEY" \
  -d '{}'
```

### GET `/api/supplements`

- 認証: `Authorization: Bearer <HEALTH_API_KEY>`
- `Active=true` がある場合は優先返却

```bash
curl -X GET "https://<worker>.workers.dev/api/supplements" \
  -H "Authorization: Bearer $HEALTH_API_KEY"
```

### POST `/api/supplement_intakes`

- 認証: `Authorization: Bearer <HEALTH_API_KEY>`

```bash
curl -X POST "https://<worker>.workers.dev/api/supplement_intakes" \
  -H "Authorization: Bearer $HEALTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "taken_at":"2026-02-11T08:15:00+09:00",
    "supplement_ids":["<supplement_page_id_1>","<supplement_page_id_2>"],
    "source":"shortcut"
  }'
```

---

## 7. iPhoneショートカット設定

### サプリ一覧取得

- `GET /api/supplements`
- Header: `Authorization: Bearer <HEALTH_API_KEY>`

### サプリ摂取記録

- `POST /api/supplement_intakes`
- Header:
  - `Authorization: Bearer <HEALTH_API_KEY>`
  - `Content-Type: application/json`
- Body: `taken_at`, `supplement_ids`, `source`

> セキュリティ注意: `HEALTH_API_KEY` はショートカット内で利用するため、ショートカット共有時の漏洩に注意してください（共有前にキー削除・再設定推奨）。

---

## 8. GitHub Actions（Meal Photos 実行）

Workflow: `.github/workflows/daily-log-meal-photos.yml`

必要な GitHub Secrets:
- `MEAL_PHOTOS_ENDPOINT`
- `HEALTH_API_KEY`

この workflow は Workers API を定期実行する「クライアント用途」です。Deploy 用 Secrets（Cloudflare API Token 等）とは用途が異なります。

---

## 9. Notion DB 要件（サプリ機能）

### Supplements DB
- `Name` (title)
- `Active` (checkbox, 推奨)

### Supplement Intake Log DB
- `Name` (title)
- `TakenAt` (date)
- `Supplement` (relation)
- `Daily Health` (relation)
- `Source` (select, 任意)

### Daily Health DB
- `Date` (date)
- `Name` (title)

