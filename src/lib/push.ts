"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Web Push の購読管理（設計書 7.5 / 8章）。
 *
 * iOS では「ホーム画面に追加して起動した PWA」でしか Push が使えない。
 * さらに許可は一度拒否されると再要求できないため、
 * 呼び出し側で必ずソフトプロンプト（自前の説明カード）を挟むこと。
 */

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS は Mac を名乗るのでタッチ有無で判定する
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** ホーム画面から起動しているか（iOS で Push が使える前提条件） */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function permissionState(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * この端末を購読登録する。
 * 1ユーザーが複数端末を持つ前提で、endpoint 単位に行を作る（全端末に送る）。
 */
export async function subscribeToPush(supabase: SupabaseClient, userId: string) {
  if (!isPushSupported()) throw new Error("この端末は Web Push に対応していません");
  if (!VAPID_PUBLIC_KEY) throw new Error("VAPID 公開鍵が設定されていません");

  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "通知がブロックされています。ブラウザの設定から許可し直してください。"
        : "通知が許可されませんでした",
    );
  }

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }));

  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint!,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      user_agent: navigator.userAgent.slice(0, 200),
      failure_count: 0,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;

  return subscription;
}

/** この端末の購読を解除する（他の端末には影響しない） */
export async function unsubscribeFromPush(supabase: SupabaseClient) {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe();
}

/** この端末が既に購読済みかどうか */
export async function currentEndpoint(): Promise<string | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}
