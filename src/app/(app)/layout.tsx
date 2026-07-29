import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SessionProvider } from "@/components/session-provider";
import { AppShell } from "@/components/app-shell";
import type { Household, Profile } from "@/lib/types";

/**
 * ログイン済み・世帯所属済みであることを保証するレイアウト。
 * ここを通ったコンポーネントは user / household が必ず存在する前提で書ける。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("household_members")
    .select("role, household_id, households(*)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/onboarding");

  // 型未生成の supabase-js ではネスト select の戻り値が推論できないため、明示的に落とす
  const household = (membership as unknown as { households: Household }).households;

  const [{ data: profile }, { data: memberRows }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase
      .from("household_members")
      .select("profiles(*)")
      .eq("household_id", household.id),
  ]);

  const members = ((memberRows ?? []) as unknown as { profiles: Profile }[])
    .map((r) => r.profiles)
    .filter(Boolean);

  const me: Profile = profile ?? {
    id: user.id,
    display_name: user.email?.split("@")[0] ?? "名無し",
    avatar_url: null,
    created_at: new Date().toISOString(),
  };

  return (
    <SessionProvider
      value={{
        user: me,
        household,
        members,
        role: (membership as unknown as { role: "owner" | "member" }).role,
      }}
    >
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
