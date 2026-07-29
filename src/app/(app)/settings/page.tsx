import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SettingsView } from "@/components/settings-view";
import type { HouseholdMember, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user!.id)
    .limit(1)
    .maybeSingle();

  const { data: members } = await supabase
    .from("household_members")
    .select("household_id, user_id, role, joined_at, profiles(*)")
    .eq("household_id", (membership as { household_id: string }).household_id)
    .order("joined_at");

  return (
    <div className="px-4 py-4">
      <SettingsView
        members={
          (members ?? []) as unknown as (HouseholdMember & { profiles: Profile })[]
        }
      />

      <Link
        href="/settings/notifications"
        className="mt-6 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5"
      >
        <Bell className="size-5 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">通知の設定</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
    </div>
  );
}
