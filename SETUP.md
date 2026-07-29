# セットアップ手順

`docs/design.md` の設計に沿って実装したアプリを動かすまでの手順です。
**フェーズ0〜4（レシピ・献立・買い物リスト・アプリ内通知）は手順1〜4だけで動きます。**
Web Push（フェーズ5）は手順5以降で、後から足せます。

---

## 1. Supabase プロジェクトを作る

1. [supabase.com](https://supabase.com) でプロジェクトを作成（リージョンは Tokyo 推奨）
2. **Project Settings → API** から次の2つを控える
   - `Project URL`
   - `anon public` キー

## 2. マイグレーションを適用する

### Supabase CLI を使う場合（推奨）

```bash
npx supabase link --project-ref <あなたのproject-ref>
npx supabase db push
```

### ダッシュボードから流す場合

**SQL Editor** で、以下を**この順番で**実行します。

| # | ファイル | 内容 | 必須 |
| --- | --- | --- | --- |
| 1 | `supabase/migrations/0001_init.sql` | テーブル・RLS・RPC・Storage | 必須 |
| 2 | `supabase/migrations/0002_notifications.sql` | 通知トリガー（アプリ内通知） | 必須 |
| 3 | `supabase/migrations/0003_push_dispatch.sql` | Push のまとめ配信ワーカー | Push を使う時だけ |
| 4 | `supabase/migrations/0004_seed_ingredient_aliases.sql` | 材料名の正規化マスタ | 推奨 |

> `0003` は `pg_cron` / `pg_net` を有効にします。**Database → Extensions** で
> 両方が有効になっていることを確認してください。Push を使わないうちは飛ばして構いません。

## 3. 認証の設定

**Authentication → URL Configuration**

- `Site URL`: `http://localhost:3000`（本番では Vercel のURL）
- `Redirect URLs` に追加:
  - `http://localhost:3000/auth/callback`
  - `https://<本番ドメイン>/auth/callback`

Google ログインも使う場合は **Authentication → Providers → Google** を有効にし、
Google Cloud Console で発行したクライアントIDとシークレットを設定します。
（メールのマジックリンクだけでも使えます）

## 4. 環境変数を設定して起動する

`.env.example` をコピーして `.env.local` を作ります。

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

```bash
npm install
npm run dev
```

`http://localhost:3000` を開き、メールアドレスを入れてログイン → 世帯を作成すれば使い始められます。
家族には **設定画面の招待コード**（8文字）を渡してください。

> 環境変数が未設定のまま開くと `/setup` に案内が出ます。

---

## 5. Web Push を有効にする（フェーズ5・後から実施可）

### 5-1. VAPID 鍵ペアを生成する

```bash
npm run gen:vapid
```

**一度だけ生成して保管してください。** 鍵を変えると既存の購読がすべて無効になります。

出力された公開鍵を `.env.local` に追記します。

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BB...（出力された値）
```

### 5-2. Edge Function をデプロイする

```bash
npx supabase functions deploy send-push --no-verify-jwt

npx supabase secrets set \
  VAPID_PUBLIC_KEY=<公開鍵> \
  VAPID_PRIVATE_KEY=<秘密鍵> \
  VAPID_SUBJECT=mailto:you@example.com
```

`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は Edge Function に自動で渡されるため、設定不要です。

### 5-3. ワーカーから Edge Function を呼べるようにする

pg_cron が Edge Function を叩くための情報を Vault に登録します（SQL Editor で実行）。

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/send-push',
  'send_push_url'
);
select vault.create_secret(
  '<service_role キー>',
  'service_role_key'
);
```

> `service_role` キーは RLS をバイパスできる強力なキーです。**クライアント側には絶対に置かないでください。**

登録後、1分ごとの cron が動き始めます。動作確認は次のクエリで行えます。

```sql
-- 手動で1回だけ掃き出す
select public.dispatch_push_notifications();

-- 通知の配信状況を見る
select type, push_status, count(*) from public.notifications group by 1, 2;
```

### 5-4. 端末で通知をオンにする

アプリの **設定 → 通知の設定** から「この端末で通知をオンにする」を押します。

- **iPhone / iPad は、Safari の共有ボタンから「ホーム画面に追加」して、そこから起動した場合のみ**
  プッシュ通知を受け取れます（Safari 16.4 以降）。追加しない場合は、アプリを開いたときの
  「お知らせ」（ベルアイコン）で確認する形になります。
- Android Chrome / デスクトップはブラウザのままで動作します。
- Service Worker は本番ビルドでのみ登録されます。ローカルで試すなら `npm run build && npm start` を使ってください。

---

## 6. Vercel にデプロイする

1. リポジトリを Vercel に接続する
2. 環境変数を設定する
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`（Push を使う場合）
   - `NEXT_PUBLIC_SITE_URL`（本番URL）
3. デプロイ後、Supabase の `Site URL` / `Redirect URLs` に本番URLを追加する

---

## トラブルシューティング

| 症状 | 原因と対処 |
| --- | --- |
| ログイン後に何も表示されない | `/onboarding` で世帯を作成したか確認。マイグレーション `0001` が適用されているか確認 |
| 「row-level security policy に違反」と出る | `0001_init.sql` の RLS 部分が流れていない可能性。SQL Editor で再実行 |
| 献立ボードが家族の端末で更新されない | Database → Replication で `supabase_realtime` に対象テーブルが入っているか確認 |
| URL取り込みでタイトルが取れない | 仕様です。相手サイトが取得を拒否している場合は手入力で保存できます（5秒でタイムアウト） |
| 通知が届かない（アプリ内にも出ない） | `0002_notifications.sql` が未適用。または自分の操作は自分に通知されない仕様 |
| Push だけ届かない | `0003` の適用、Vault の2つのシークレット、Edge Function のデプロイ、静かな時間帯（既定22:00〜7:00）を確認 |
