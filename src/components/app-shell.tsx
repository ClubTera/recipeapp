"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, ShoppingCart, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notification-bell";
import { useSession } from "@/components/session-provider";

const TABS = [
  { href: "/", label: "レシピ", icon: BookOpen, match: (p: string) => p === "/" || p.startsWith("/recipes") },
  { href: "/plan", label: "献立", icon: CalendarDays, match: (p: string) => p.startsWith("/plan") },
  { href: "/shopping", label: "買い物", icon: ShoppingCart, match: (p: string) => p.startsWith("/shopping") },
  { href: "/settings", label: "設定", icon: Settings, match: (p: string) => p.startsWith("/settings") },
];

const TITLES: [RegExp, string][] = [
  [/^\/$/, "レシピ"],
  [/^\/recipes\/new/, "レシピを追加"],
  [/^\/recipes\/[^/]+\/edit/, "レシピを編集"],
  [/^\/recipes\//, "レシピ"],
  [/^\/plan/, "今週の献立"],
  [/^\/shopping/, "買い物リスト"],
  [/^\/settings\/notifications/, "通知設定"],
  [/^\/settings/, "設定"],
  [/^\/notifications/, "お知らせ"],
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { household } = useSession();
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? "家族のレシピ";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">{title}</h1>
          <p className="truncate text-xs text-muted-foreground">{household.name}</p>
        </div>
        <NotificationBell />
      </header>

      <main className="flex-1 pb-24">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-3xl border-t border-border bg-background/95 backdrop-blur">
        <ul className="flex items-stretch pb-[env(safe-area-inset-bottom)]">
          {TABS.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  className={cn(
                    "flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className={cn("size-6", active && "stroke-[2.4]")} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
