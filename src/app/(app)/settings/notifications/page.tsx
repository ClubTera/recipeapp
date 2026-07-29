import { createClient } from "@/lib/supabase/server";
import { NotificationSettings } from "@/components/notification-settings";
import type { NotificationPreferences, PushSubscriptionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: prefs }, { data: devices }] = await Promise.all([
    supabase.from("notification_preferences").select("*").eq("user_id", user!.id).maybeSingle(),
    supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <NotificationSettings
      preferences={
        (prefs as NotificationPreferences | null) ?? {
          user_id: user!.id,
          enabled_types: [
            "meal_candidate_added",
            "meal_vote",
            "meal_comment",
            "meal_confirmed",
            "shopping_list_created",
            "member_joined",
          ],
          quiet_hours_start: "22:00:00",
          quiet_hours_end: "07:00:00",
          timezone: "Asia/Tokyo",
        }
      }
      devices={(devices ?? []) as PushSubscriptionRow[]}
    />
  );
}
