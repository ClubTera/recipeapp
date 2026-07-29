"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BellOff, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { AppNotification } from "@/lib/types";

/**
 * アプリ内通知センター（設計書 7.1 の第1層）。
 * Push が使えない端末でも、ここを開けば家族の動きに必ず気付ける。
 */
export function NotificationCenter({ notifications }: { notifications: AppNotification[] }) {
  const router = useRouter();
  const [items, setItems] = useState(notifications);

  useEffect(() => setItems(notifications), [notifications]);

  const unreadCount = items.filter((n) => !n.read_at).length;

  const markRead = async (id: string) => {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    const supabase = createClient();
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    const supabase = createClient();
    await supabase.rpc("mark_all_notifications_read");
    router.refresh();
  };

  return (
    <div className="px-4 py-4">
      {unreadCount > 0 ? (
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">未読 {unreadCount}件</p>
          <Button variant="ghost" size="sm" onClick={markAllRead}>
            <CheckCheck className="size-4" />
            すべて既読にする
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={<BellOff className="size-10" />}
          title="お知らせはまだありません"
          description="家族が献立に候補を追加したり、コメントするとここに届きます。"
        />
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <Link
                href={n.link_path}
                onClick={() => {
                  if (!n.read_at) markRead(n.id);
                }}
                className={cn(
                  "block rounded-lg border p-3 transition",
                  n.read_at
                    ? "border-border bg-card"
                    : "border-primary/40 bg-accent/60",
                )}
              >
                <div className="flex items-start gap-2">
                  {!n.read_at ? (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  ) : (
                    <span className="mt-1.5 size-2 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatRelativeTime(n.created_at)}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
