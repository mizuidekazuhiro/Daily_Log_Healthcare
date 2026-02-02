# Daily Log Healthcare (Notion ⇄ Cloudflare Workers)

iPhoneショートカットが深夜に前日分の体重・PFCをCloudflare WorkersへPOSTし、WorkersがNotionのDaily_Log DBに対して `date (YYYY-MM-DD)` をキーに **Upsert**（存在すれば部分更新、なければ作成）します。

さらに、**毎朝 7:00 JST** に Dropbox の特定フォルダにある「前日分の食事写真」を Notion の Daily_Log DB に自動添付します（Cron + Dropbox API）。

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
>- **Meal Photos (Files & media)** ← 追加

---

## 1. セットアップ全体像

1. GitHubでリポジトリ作成 → ファイルを追加してコミット
2. Cloudflare Workers にデプロイ
3. Notion DB にプロパティ追加（Meal Photos）
4. Dropbox App を作成してアクセストークン取得
5. Workers の環境変数を設定
6. Cron と手動エンドポイントで動作確認

---

## 2. GitHubで新規レポ作成 → ブラウザ編集でコミット

1. GitHubで **新規リポジトリ**を作成（空の状態でOK）。
2. このリポジトリに以下のファイルを**ブラウザ編集だけで**追加/作成してコミット。
   - `package.json`
   - `wrangler.toml`
   - `src/index.ts`
   - `README.md`
   - `.gitignore`

> ローカル環境は不要です。GitHubのブラウザ編集のみで完結します。

---

## 3. Cloudflare Dashboard → Workers & Pages → Connect to Git

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Workers**
2. **Connect to Git** を選択
3. 対象リポジトリを選択

### デプロイ設定
- **Build/Deploy command**: `npx wrangler deploy`（最短・確実）
  - もしくは `npm run deploy` でも可

> **CLI で直接デプロイしたい場合**
> ```bash
> npx wrangler deploy
> ```

---

## 4. Notion側の準備（Meal Photos プロパティを追加）

1. Notionで対象の **Daily_Log** データベースを開く
2. 右端の「＋」でプロパティを追加
3. 名前を **Meal Photos** に設定
4. タイプを **Files & media** に設定

> **注意**: プロパティ名は大文字小文字含めて完全一致が必要です。

---

## 5. Dropbox側の準備（アクセストークン取得）

1. https://www.dropbox.com/developers/apps にアクセス
2. **Create App** → **Scoped access** を選択
3. Access type は **Full Dropbox** もしくは **App folder** を選択
4. App 名を入力して作成
5. **Permissions** タブで以下を有効化
   - `files.metadata.read`
   - `sharing.read`
   - `sharing.write`
6. **Settings** タブで **Generated access token** を発行
7. 発行されたトークンを控える

> App folder を使う場合は Dropbox 上でそのアプリ用フォルダが作られます。

---

## 6. Cloudflare側で環境変数を設定

Workers の **Settings → Variables** で以下を追加:

- `NOTION_TOKEN` : Notionのインテグレーショントークン
- `DAILY_LOG_DB_ID` : Daily_Log DB ID
- `HEALTH_API_KEY` : APIキー（iPhoneショートカットの `X-API-Key` と一致させる）
- `DROPBOX_ACCESS_TOKEN` : Dropboxのアクセストークン
- `DROPBOX_FOLDER_PATH` : 食事写真フォルダのパス（例: `/MealPhotos`）

---

## 7. 既存の Health Upsert API

### エンドポイント
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

### 動作確認（curl）

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

---

## 8. 食事写真の自動添付（新機能）

### 仕様
- **毎朝 7:00 JST** に Cloudflare Workers の Cron で実行
- Dropbox の指定フォルダから「前日分の食事写真」を抽出
- Notion の Daily_Log DB の「前日の日付（Date=YYYY-MM-DD）」ページに添付
- 添付先プロパティは **Meal Photos (Files & media)**
- Dropbox は **共有リンク（shared link）** を利用（なければ作成）
- Notion には **external file** として登録
- **同一 Dropbox file.id は重複添付しない**

### Dropboxフォルダ内の「前日分」の定義
- Dropbox の `server_modified` を **JST** に変換
- JST日付が「前日（YYYY-MM-DD）」のファイルを対象

### Cron の設定
`wrangler.toml` の Cron 設定は以下です（JST → UTC 変換済み）:

```toml
[triggers]
# 07:00 JST = 22:00 UTC (previous day)
crons = ["0 22 * * *"]
```

---

## 9. 手動実行（任意・推奨）

### エンドポイント
- **POST** `https://<worker>.workers.dev/api/daily-log/meal-photos/run`
- **認証**: `X-API-Key` ヘッダー必須

### リクエスト例（前日分）
```bash
curl -X POST "https://<worker>.workers.dev/api/daily-log/meal-photos/run" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <YOUR_API_KEY>" \
  -d '{}'
```

### リクエスト例（任意の日付を指定）
```bash
curl -X POST "https://<worker>.workers.dev/api/daily-log/meal-photos/run" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <YOUR_API_KEY>" \
  -d '{ "date": "2026-01-25" }'
```

---

## 10. Cronが動いていることの確認

- Cloudflare Dashboard → **Workers & Pages** → 対象 Worker
- **Logs** で Cron 実行ログを確認
- もしくは手動エンドポイントで実行して結果を確認

---

## 11. ありがちなエラーと対処

### 401 Unauthorized
- `X-API-Key` が Workers env の `HEALTH_API_KEY` と一致しない。

### 404 Not Found
- パスが `/api/health/daily` もしくは `/api/daily-log/meal-photos/run` になっていない。

### 502 Notion error
- `DAILY_LOG_DB_ID` が誤っている
- NotionのインテグレーションにDB共有がされていない
- **Notion側のプロパティ名が違う**（本README冒頭の固定名を厳守）

### Dropbox 4xx エラー
- `DROPBOX_ACCESS_TOKEN` が無効、期限切れ
- Dropbox App のスコープが不足している

### 画像が付かない
- `DROPBOX_FOLDER_PATH` が正しく設定されているか確認
- 対象ファイルの `server_modified` が **JSTで前日** になっているか確認
- 対象ファイルの拡張子が画像形式（.jpg/.png/.heic など）か確認

### 重複して添付される
- `Meal Photos` のファイル名に Dropbox `file.id` が含まれているか確認
- 既に含まれている場合はスキップされます

---

## 仕様まとめ

### Health Upsert
- エンドポイント: **POST /api/health/daily**
- 認証: **X-API-Key**
- date を唯一キーとして Upsert
- payloadのキーだけ更新（null/undefinedは上書きしない）
- Notion Version: **2022-06-28**

### Meal Photos
- Cron: **毎朝 7:00 JST**（`0 22 * * *` UTC）
- Dropbox 共有リンク（shared link）を external file として Notion に追加
- 重複判定キー: Dropbox `file.id`
- 前日判定は JST 基準
