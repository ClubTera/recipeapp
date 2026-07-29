import { AlertTriangle } from "lucide-react";

/**
 * 環境変数が未設定のときに middleware がここへ逃がす。
 * 「起動したのに真っ白で理由が分からない」を避けるための画面。
 */
export default function SetupPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="mb-6 flex items-center gap-3">
        <AlertTriangle className="size-7 text-primary" />
        <h1 className="text-2xl font-bold">セットアップが必要です</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Supabase の接続情報が設定されていません。以下の手順で <code>.env.local</code> を作成してください。
      </p>

      <ol className="mt-6 space-y-4 text-sm">
        <li>
          <p className="font-medium">1. Supabase プロジェクトを作成する</p>
          <p className="text-muted-foreground">
            supabase.com でプロジェクトを作り、Project Settings → API から URL と anon key を控えます。
          </p>
        </li>
        <li>
          <p className="font-medium">2. マイグレーションを適用する</p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>supabase link --project-ref &lt;ref&gt;{"\n"}supabase db push</code>
          </pre>
          <p className="text-muted-foreground">
            SQL Editor に <code>supabase/migrations/</code> の中身を順に貼り付けても構いません。
          </p>
        </li>
        <li>
          <p className="font-medium">3. .env.local を作成する</p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>
              NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co{"\n"}
              NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
            </code>
          </pre>
        </li>
        <li>
          <p className="font-medium">4. 開発サーバーを再起動する</p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>npm run dev</code>
          </pre>
        </li>
      </ol>

      <p className="mt-8 text-sm text-muted-foreground">
        詳しい手順は <code>SETUP.md</code> を参照してください。
      </p>
    </div>
  );
}
