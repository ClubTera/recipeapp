"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Home, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldHint } from "@/components/ui/input";

type Mode = "create" | "join";

export default function OnboardingPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [displayName, setDisplayName] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 既に世帯に入っている場合はここに留まらせない
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", data.user.id)
        .maybeSingle();
      if (profile?.display_name) setDisplayName(profile.display_name);

      const { data: member } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("user_id", data.user.id)
        .limit(1)
        .maybeSingle();
      if (member) router.replace("/");
    });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("ログインが必要です");

      if (displayName.trim()) {
        await supabase
          .from("profiles")
          .update({ display_name: displayName.trim() })
          .eq("id", user.id);
      }

      if (mode === "create") {
        const { error } = await supabase.rpc("create_household", {
          p_name: householdName.trim(),
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("join_household", {
          p_code: inviteCode.trim().toUpperCase(),
        });
        if (error) throw error;
      }

      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "処理に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-bold">世帯をつくる</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        レシピ・献立・買い物リストは「世帯」の中で家族全員に共有されます。
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
        <button
          type="button"
          onClick={() => setMode("create")}
          className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition ${
            mode === "create" ? "bg-card shadow-sm" : "text-muted-foreground"
          }`}
        >
          <Home className="size-4" />
          新しく作る
        </button>
        <button
          type="button"
          onClick={() => setMode("join")}
          className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition ${
            mode === "join" ? "bg-card shadow-sm" : "text-muted-foreground"
          }`}
        >
          <UserPlus className="size-4" />
          招待コードで参加
        </button>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="display-name">あなたの表示名</Label>
          <Input
            id="display-name"
            required
            placeholder="おかあさん"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <FieldHint>献立の提案やコメントにこの名前が表示されます。</FieldHint>
        </div>

        {mode === "create" ? (
          <div>
            <Label htmlFor="household-name">世帯の名前</Label>
            <Input
              id="household-name"
              required
              placeholder="山田家"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
            />
            <FieldHint>作成後、設定画面の招待コードで家族を招待できます。</FieldHint>
          </div>
        ) : (
          <div>
            <Label htmlFor="invite-code">招待コード</Label>
            <Input
              id="invite-code"
              required
              maxLength={8}
              autoCapitalize="characters"
              placeholder="ABCD2345"
              className="font-mono text-lg tracking-widest uppercase"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            />
            <FieldHint>家族から共有された8文字のコードを入力してください。</FieldHint>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? "処理中…" : mode === "create" ? "世帯を作成する" : "参加する"}
        </Button>
      </form>

      {error ? (
        <p className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
