"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CookingPot, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldHint } from "@/components/ui/input";

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const redirectTo = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo() },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectTo() },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました");
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <CookingPot className="size-9" />
        </div>
        <h1 className="text-2xl font-bold">家族のレシピ</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          レシピを貯めて、家族で献立を相談して、
          <br />
          買い物リストまで一本でつなぐ。
        </p>
      </div>

      {sent ? (
        <div className="rounded-lg border border-border bg-card p-5 text-center">
          <Mail className="mx-auto mb-3 size-8 text-primary" />
          <p className="font-medium">メールを送りました</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {email} 宛のリンクを開くとログインできます。
          </p>
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => setSent(false)}>
            別のメールアドレスを使う
          </Button>
        </div>
      ) : (
        <form onSubmit={sendMagicLink} className="space-y-4">
          <div>
            <Label htmlFor="email">メールアドレス</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <FieldHint>パスワードは不要です。届いたリンクを開くだけでログインできます。</FieldHint>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? "送信中…" : "ログインリンクを送る"}
          </Button>

          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">または</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" size="lg" className="w-full" onClick={signInWithGoogle}>
            Google でログイン
          </Button>
        </form>
      )}

      {error ? (
        <p className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
