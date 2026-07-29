import { createClient } from "@/lib/supabase/server";
import { NotificationCenter } from "@/components/notification-center";
import type { AppNotification } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  return <NotificationCenter notifications={(data ?? []) as AppNotification[]} />;
}
