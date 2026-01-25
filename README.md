# Daily Log Healthcare (Notion ⇄ Cloudflare Workers)

iPhoneショートカットが深夜に前日分の体重・PFCをCloudflare WorkersへPOSTし、WorkersがNotionのDaily_Log DBに対して `date (YYYY-MM-DD)` をキーに **Upsert**（存在すれば部分更新、なければ作成）します。

> **注意: Notion側のプロパティ名は固定です（コード内も一致）**
>
>- Name (Title)
>- Date (Date)
>- Weight (Number)
>- Protein (Number)
>- Fat (Number)
>- Carb (Number)
>- Kcal (Number)
>- Source (Select)

## 1. GitHubで新規レポ作成 → ブラウザ編集でコミット

1. GitHubで **新規リポジトリ**を作成（空の状態でOK）。
2. このリポジトリに以下のファイルを**ブラウザ編集だけで**追加/作成してコミット。
   - `package.json`
   - `wrangler.toml`
   - `src/index.ts`
   - `README.md`
   - `.gitignore`

> ローカル環境は不要です。GitHubのブラウザ編集のみで完結します。

## 2. Cloudflare Dashboard → Workers & Pages → Connect to Git

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Workers**
2. **Connect to Git** を選択
3. 対象リポジトリを選択

### デプロイ設定
- **Build/Deploy command**: `npx wrangler deploy`（最短・確実）
  - もしくは `npm run deploy` でも可

## 3. Cloudflare側で環境変数を設定

Workersの **Settings → Variables** で以下を追加:

- `NOTION_TOKEN` : Notionのインテグレーショントークン
- `DAILY_LOG_DB_ID` : Daily_Log DB ID
- `HEALTH_API_KEY` : APIキー（iPhoneショートカットの `X-API-Key` と一致させる）

## 4. エンドポイント

- **POST** `https://<worker>.workers.dev/api/health/daily`
- **認証**: `X-API-Key` ヘッダー必須

### JSON payload 例
```json
{
  "date": "2026-01-25",
  "weight": 71.2,
  "protein": 120,
  "fat": 60,
  "carb": 220,
  "kcal": 2100,
  "source": "healthcare kit"
}
```

- `date` は必須。
- **payloadで送られてきたキーだけ**を更新（`null/undefined` は上書きしません）。
- 数値は **number & finite** のみ受け付けます。
- `source` は空文字なら更新しません。

## 5. 動作確認（curl）

```bash
curl -X POST "https://<worker>.workers.dev/api/health/daily" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <YOUR_API_KEY>" \
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

### 期待されるNotion側の更新
- **Date** が `2026-01-25` のページがあれば、そのページの指定プロパティのみ更新
- 無ければ新規作成（`Name` は `Daily Log | 2026-01-25`）

## 6. iPhoneショートカットのPOST設定要点

- **URL**: `https://<worker>.workers.dev/api/health/daily`
- **Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`
  - `X-API-Key: <YOUR_API_KEY>`
- **Body (JSON)**: 上記のpayload例をベースに必要な項目だけ送信

## 7. ありがちなエラーと対処

### 401 Unauthorized
- `X-API-Key` が Workers env の `HEALTH_API_KEY` と一致しない。

### 404 Not Found
- パスが `/api/health/daily` になっていない。

### 502 Notion error
- `DAILY_LOG_DB_ID` が誤っている
- NotionのインテグレーションにDB共有がされていない
- **Notion側のプロパティ名が違う**（本README冒頭の固定名を厳守）

### Notion側のプロパティ名が違うと更新できない
- `Weight` や `Protein` など、**大文字小文字も含めて完全一致**が必要です。

---

## 仕様まとめ

- エンドポイント: **POST /api/health/daily**
- 認証: **X-API-Key**
- date を唯一キーとして Upsert
- payloadのキーだけ更新（null/undefinedは上書きしない）
- Notion Version: **2022-06-28**
