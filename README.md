# 家族のレシピ

インターネット・動画・SNS・自作のレシピを一元的に保存し、家族で共有・献立相談・買い物リスト化まで行う PWA。
設計書は [docs/design.md](docs/design.md)、セットアップ手順は [SETUP.md](SETUP.md) を参照してください。

**本番URL**: https://recipe-zeta-five.vercel.app

```
レシピを貯める  →  週の献立を家族で相談して決める  →  確定した献立から買い物リストを自動生成
```

この3つが一本の線でつながっていることがこのアプリの価値です。単なるブックマーク集にはしていません。

## 技術スタック

| 項目 | 採用 |
| --- | --- |
| フロントエンド | Next.js 15 (App Router) + TypeScript + Tailwind CSS v4 |
| バックエンド | Supabase（Postgres / Auth / Storage / Realtime / Edge Functions） |
| 権限境界 | Postgres の RLS（読み書きは基本すべてクライアントから直接） |
| 通知 | アプリ内通知センター（DBトリガー）＋ Web Push（VAPID）の二層 |
| ホスティング | Vercel |

## 起動

```bash
npm install
cp .env.example .env.local   # Supabase の URL と anon key を設定
npm run dev
```

環境変数が未設定の場合は `/setup` に手順が表示されます。

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` / `npm start` | 本番ビルド・起動（**Service Worker はこちらでのみ有効**） |
| `npm run typecheck` | 型チェック |
| `npm run gen:vapid` | VAPID 鍵ペアを生成（一度だけ） |
| `node scripts/generate-icons.mjs` | PWA アイコンを再生成 |

## ディレクトリ

```
src/
  app/
    (app)/                     ログイン＋世帯所属が保証された領域
      page.tsx                 レシピ一覧
      recipes/new|[id]|edit    レシピ追加・詳細・編集
      plan/                    献立ボード / [date]/[slot] スロット詳細
      shopping/                買い物リスト
      notifications/           通知センター
      settings/                世帯・メンバー / notifications 通知設定
    login/ onboarding/ setup/  未所属でも開ける画面
    auth/callback/             マジックリンク・OAuth のコールバック
    api/extract-metadata/      URLメタ取得（唯一のサーバー経路）
  components/                  画面部品
  lib/
    supabase/                  クライアント（ブラウザ / サーバー）
    metadata.ts                OGP / JSON-LD / oEmbed の解析
    ingredients.ts             材料の解析・正規化・合算
    shopping.ts                買い物リストの生成
    push.ts                    Web Push の購読管理
supabase/
  migrations/                  スキーマ・RLS・通知トリガー・配信ワーカー・シード
  functions/send-push/         Push 配信の Edge Function（Deno）
public/
  sw.js                        Service Worker（キャッシュ＋Push を1本に集約）
  manifest.webmanifest         PWA マニフェスト
```

## 実装状況（設計書 9章のロードマップ）

| フェーズ | 内容 | 状態 |
| --- | --- | --- |
| 0 | 認証・世帯作成／招待コードで参加 | 実装済み |
| 1 | レシピ CRUD、URL取り込み、画像アップロード、検索・絞り込み | 実装済み |
| 2 | 買い物リスト（手動追加・チェック・Realtime・カテゴリ分類） | 実装済み |
| 3 | 献立ボード（週表示・候補・投票・コメント・確定・Realtime） | 実装済み |
| 3.5 | 通知センター（DBトリガー＋未読バッジ） | 実装済み |
| 4 | 献立→買い物リスト自動生成（正規化・合算・プレビュー） | 実装済み |
| 5 | PWA・Service Worker・Web Push・まとめ配信・通知設定 | 実装済み（要 VAPID 設定） |
| 6 | 磨き込み（タグ・調理記録・お気に入り・ソート） | 一部実装（統計・N5リマインドはSQL側のみ） |

## 設計上の要点

**取り込みは失敗する前提で作っている。** `/api/extract-metadata` は取得に失敗しても 200 と
`warning` を返し、フォームは常に手入力で完結できます。5秒でタイムアウトします。
Instagram は最初から「取得しない」と決めて、URLと投稿者だけを保存します。

**材料は `raw_text` が正。** 表示は常に入力そのままです。分量の解析（`lib/ingredients.ts`）は
買い物リストの合算にのみ使い、「少々」「適量」など量が決まらないものは合算せず個別行として残します。

**買い物リストの生成は必ずプレビューを挟む。** 調味料は既定でチェックを外しています。
自動生成をそのまま押し付けると調味料だらけのリストになり、使われなくなるためです。

**通知は二層。** アプリ内通知（`notifications` テーブル＋DBトリガー）が土台で、外部依存なく必ず動きます。
Web Push はその上乗せで、iOS ではホーム画面に追加した PWA でしか届きません。
通知の生成と配信を分けているので、Push が使えない端末でもアプリを開けば必ず気付けます。

**通知が多すぎて全員にオフにされないための仕掛け。** 自分の操作は自分に通知しない、
同一ユーザー・同一種別は5分バッファでまとめて1通、静かな時間帯（既定22:00〜7:00）は送らない、
種別ごとにオン/オフ可能、リマインドは既定オフ。許可ダイアログは
「家族が2人以上」または「初めて候補を提案した直後」にソフトプロンプト経由でのみ出します。

## 設計書からの差分

実装にあたって次の3点だけ設計書と変えています。いずれも意図的なものです。

1. **静かな時間帯の判定を Edge Function ではなく DB 側で行う。** 受信者ごとのタイムゾーンと
   時間帯設定を持っているのは DB なので、そこで `skipped` に落とした方が確実で、外部通信も減ります。
2. **まとめ配信のグルーピングキーから `entity_id` を外した。** 設計書の
   `(recipient_id, actor_id, type, entity_id)` では候補ごとに `entity_id` が違うため
   「3件の候補を追加しました」に集約されません。`(recipient_id, actor_id, type)` でまとめています。
3. **shadcn/ui の CLI は使わず、同等のコンポーネントを `src/components/ui/` に直接置いた。**
   依存を増やさず、必要な部品（Button / Input / Card / Sheet）だけに絞るためです。

## 既知の制限

- Supabase の型は生成していません（`supabase gen types typescript` で生成した型に差し替えると、
  クエリ結果のキャストを外せます）。
- URLメタ取得のキャッシュはプロセス内 Map です。インスタンスをまたぐ共有はしていません。
- 書き込みのオフライン対応は範囲外です（閲覧のキャッシュのみ）。
- 献立の確定は楽観ロック（`updated_at` 比較）で後着を検知し、画面で再読込を促します。
