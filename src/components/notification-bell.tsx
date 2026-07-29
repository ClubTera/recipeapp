"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/session-provider";

/**
 * 未読バッジ付きのベル。
 * notifications を Realtime 購読して、家族の操作が即座にバッジへ反映される（設計書 6.1）。
 */
export function NotificationBell() {
  const { user } = useSession();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const load = async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", user.id)
        .is("read_at", null);
      if (!cancelled) setUnread(count ?? 0);
    };

    load();

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${user.id}`,
        },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user.id]);

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `お知らせ（未読${unread}件）` : "お知らせ"}
      className="relative rounded-md p-2 text-foreground transition hover:bg-muted"
    >
      <Bell className="size-6" />
      {unread > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
