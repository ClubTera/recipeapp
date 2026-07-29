"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, LogOut, RefreshCw, Share2, UserMinus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/card";
import { InstallHint } from "@/components/install-hint";
import type { HouseholdMember, Profile } from "@/lib/types";

export function SettingsView({
  members,
}: {
  members: (HouseholdMember & { profiles: Profile })[];
}) {
  const router = useRouter();
  const { user, household, role } = useSession();
  const [displayName, setDisplayName] = useState(user.display_name);
  const [inviteCode, setInviteCode] = useState(household.invite_code);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const saveProfile = async () => {
    setBusy(true);
    try {
      const supabase = createClient();
      await supabase
        .from("profiles")
        .update({ display_name: displayName.trim() })
        .eq("id", user.id);
      setMessage("表示名を保存しました");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("コピーできませんでした。手で控えてください。");
    }
  };

  const shareInvite = async () => {
    const text = `「${household.name}」に参加しよう！\n招待コード: ${inviteCode}\n${window.location.origin}/onboarding`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "家族のレシピ", text });
      } catch {
        // ユーザーがキャンセルしただけなので何もしない
      }
    } else {
      copyInvite();
    }
  };

  const regenerate = async () => {
    if (!confirm("招待コードを作り直すと、今のコードは使えなくなります。よろしいですか？")) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("regenerate_invite_code", {
        p_household_id: household.id,
      });
      if (error) throw error;
      setInviteCode(data as string);
      setMessage("招待コードを作り直しました");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (member: HouseholdMember) => {
    if (!confirm(`${member.profiles?.display_name ?? "この人"}を世帯から外しますか？`)) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("household_members")
      .delete()
      .eq("household_id", member.household_id)
      .eq("user_id", member.user_id);
    setMessage(error ? error.message : "メンバーを外しました");
    router.refresh();
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <InstallHint />

      <section>
        <h3 className="mb-2 text-sm font-semibold">プロフィール</h3>
        <Label htmlFor="display-name">表示名</Label>
        <div className="flex gap-2">
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Button onClick={saveProfile} disabled={busy || !displayName.trim()}>
            保存
          </Button>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">世帯</h3>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="font-medium">{household.name}</p>
          <p className="mt-3 text-xs text-muted-foreground">招待コード</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-lg tracking-widest">
              {inviteCode}
            </code>
            <Button variant="outline" size="icon" aria-label="コピー" onClick={copyInvite}>
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            </Button>
            <Button variant="outline" size="icon" aria-label="共有" onClick={shareInvite}>
              <Share2 className="size-4" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            家族にこのコードを伝えると、同じ世帯に参加できます。
          </p>
          {role === "owner" ? (
            <Button variant="ghost" size="sm" className="mt-2" onClick={regenerate} disabled={busy}>
              <RefreshCw className="size-4" />
              コードを作り直す
            </Button>
          ) : null}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">メンバー（{members.length}人）</h3>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                {(m.profiles?.display_name ?? "?").slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {m.profiles?.display_name ?? "名無し"}
                  {m.user_id === user.id ? "（自分）" : ""}
                </span>
              </span>
              {m.role === "owner" ? <Badge tone="primary">オーナー</Badge> : null}
              {role === "owner" && m.user_id !== user.id ? (
                <button
                  type="button"
                  onClick={() => removeMember(m)}
                  aria-label="メンバーを外す"
                  className="p-1 text-muted-foreground"
                >
                  <UserMinus className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {message ? (
        <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">{message}</p>
      ) : null}

      <Button variant="outline" className="w-full" onClick={signOut}>
        <LogOut className="size-4" />
        ログアウト
      </Button>
    </div>
  );
}
