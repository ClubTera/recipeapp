"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Smartphone, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/card";
import {
  currentEndpoint,
  isIOS,
  isPushSupported,
  isStandalone,
  permissionState,
  subscribeToPush,
  unsubscribeFromPush,
  VAPID_PUBLIC_KEY,
} from "@/lib/push";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { NotificationPreferences, NotificationType, PushSubscriptionRow } from "@/lib/types";

const TYPES: { value: NotificationType; label: string; description: string }[] = [
  {
    value: "meal_candidate_added",
    label: "献立に候補が追加された",
    description: "家族が新しいメニューを提案したとき",
  },
  { value: "meal_vote", label: "自分の提案に👍が付いた", description: "提案者にだけ届きます" },
  { value: "meal_comment", label: "候補にコメントが付いた", description: "会話に参加している人へ" },
  { value: "meal_confirmed", label: "献立が確定した", description: "その日のメニューが決まったとき" },
  {
    value: "shopping_list_created",
    label: "買い物リストができた",
    description: "献立から買い物リストを作ったとき",
  },
  { value: "member_joined", label: "新しいメンバーが参加した", description: "" },
  {
    value: "shopping_done",
    label: "買い物が完了した",
    description: "既定はオフ（通知が増えすぎるため）",
  },
  {
    value: "plan_reminder",
    label: "未投票のリマインド",
    description: "既定はオフ。1日1回まで届きます",
  },
];

export function NotificationSettings({
  preferences,
  devices,
}: {
  preferences: NotificationPreferences;
  devices: PushSubscriptionRow[];
}) {
  const router = useRouter();
  const { user } = useSession();
  const [enabled, setEnabled] = useState<NotificationType[]>(preferences.enabled_types);
  const [quietStart, setQuietStart] = useState(preferences.quiet_hours_start.slice(0, 5));
  const [quietEnd, setQuietEnd] = useState(preferences.quiet_hours_end.slice(0, 5));
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [permission, setPermission] = useState<string>("default");

  useEffect(() => {
    setPermission(permissionState());
    currentEndpoint().then(setThisEndpoint);
  }, []);

  const persist = async (next: Partial<NotificationPreferences>) => {
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("notification_preferences").upsert(
        {
          user_id: user.id,
          enabled_types: next.enabled_types ?? enabled,
          quiet_hours_start: (next.quiet_hours_start ?? quietStart) + ":00",
          quiet_hours_end: (next.quiet_hours_end ?? quietEnd) + ":00",
          timezone: preferences.timezone,
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const toggleType = (type: NotificationType) => {
    const next = enabled.includes(type) ? enabled.filter((t) => t !== type) : [...enabled, type];
    setEnabled(next);
    persist({ enabled_types: next });
  };

  const enablePush = async () => {
    setPushBusy(true);
    setMessage(null);
    try {
      const supabase = createClient();
      await subscribeToPush(supabase, user.id);
      setThisEndpoint(await currentEndpoint());
      setPermission(permissionState());
      setMessage("この端末で通知を受け取れるようになりました");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "通知を有効にできませんでした");
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    setPushBusy(true);
    try {
      const supabase = createClient();
      await unsubscribeFromPush(supabase);
      setThisEndpoint(null);
      setMessage("この端末の通知を停止しました");
      router.refresh();
    } finally {
      setPushBusy(false);
    }
  };

  const removeDevice = async (device: PushSubscriptionRow) => {
    const supabase = createClient();
    await supabase.from("push_subscriptions").delete().eq("id", device.id);
    if (device.endpoint === thisEndpoint) setThisEndpoint(null);
    router.refresh();
  };

  const iosNeedsInstall = isIOS() && !isStandalone();
  const supported = isPushSupported();
  const subscribed = Boolean(thisEndpoint);

  return (
    <div className="space-y-6 px-4 py-4">
      {/* Push（第2層） */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">この端末へのプッシュ通知</h3>

        {iosNeedsInstall ? (
          <div className="rounded-lg border border-primary/40 bg-accent p-4 text-sm text-accent-foreground">
            <p className="font-medium">ホーム画面に追加すると通知を受け取れます</p>
            <p className="mt-1 text-xs">
              iPhone / iPad では、Safari の共有ボタンから「ホーム画面に追加」して、そこから起動した場合のみ
              プッシュ通知を受け取れます。アプリを開いたときの「お知らせ」は、追加しなくても届きます。
            </p>
          </div>
        ) : !supported ? (
          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            この端末はプッシュ通知に対応していません。アプリ内の「お知らせ」からは確認できます。
          </p>
        ) : !VAPID_PUBLIC_KEY ? (
          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            サーバー側で VAPID 公開鍵が設定されていないため、プッシュ通知は利用できません。
          </p>
        ) : permission === "denied" ? (
          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            通知がブロックされています。ブラウザのサイト設定から「通知」を許可してから、もう一度お試しください。
          </p>
        ) : (
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm">
              {subscribed
                ? "この端末で通知を受け取れます。"
                : "アプリを閉じていても、家族の相談を受け取れるようにします。"}
            </p>
            <Button
              className="mt-3"
              variant={subscribed ? "outline" : "default"}
              onClick={subscribed ? disablePush : enablePush}
              disabled={pushBusy}
            >
              {pushBusy ? <Loader2 className="size-4 animate-spin" /> : null}
              {subscribed ? "この端末の通知を止める" : "この端末で通知をオンにする"}
            </Button>
          </div>
        )}

        {devices.length > 0 ? (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                <Smartphone className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{describeDevice(d.user_agent)}</span>
                  <span className="text-[11px] text-muted-foreground">
                    登録: {formatRelativeTime(d.created_at)}
                  </span>
                </span>
                {d.endpoint === thisEndpoint ? <Badge tone="primary">この端末</Badge> : null}
                <button
                  type="button"
                  onClick={() => removeDevice(d)}
                  aria-label="この端末を解除"
                  className="p-1 text-muted-foreground"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* 種別ごとのオン/オフ */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">受け取る通知</h3>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {TYPES.map((t) => {
            const on = enabled.includes(t.value);
            return (
              <li key={t.value} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t.label}</span>
                  {t.description ? (
                    <span className="block text-xs text-muted-foreground">{t.description}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={t.label}
                  onClick={() => toggleType(t.value)}
                  className={cn(
                    "relative h-6 w-11 shrink-0 rounded-full transition",
                    on ? "bg-primary" : "bg-input",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-5 rounded-full bg-white transition",
                      on ? "left-[22px]" : "left-0.5",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          同じ人からの同じ種類の通知は5分ぶんまとめて1通にして届きます。
        </p>
      </section>

      {/* 静かな時間帯 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">静かな時間帯</h3>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            この時間帯はプッシュ通知を送りません（アプリ内の「お知らせ」には残ります）。
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="quiet-start">開始</Label>
              <Input
                id="quiet-start"
                type="time"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                onBlur={() => persist({ quiet_hours_start: quietStart })}
              />
            </div>
            <span className="pb-3">〜</span>
            <div className="flex-1">
              <Label htmlFor="quiet-end">終了</Label>
              <Input
                id="quiet-end"
                type="time"
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                onBlur={() => persist({ quiet_hours_end: quietEnd })}
              />
            </div>
          </div>
        </div>
      </section>

      {saving ? <p className="text-xs text-muted-foreground">保存中…</p> : null}
      {message ? (
        <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">{message}</p>
      ) : null}
    </div>
  );
}

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "不明な端末";
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows PC";
  return "その他の端末";
}
