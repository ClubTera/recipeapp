"use client";

import { useEffect, useState } from "react";
import { Bell, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import {
  isIOS,
  isPushSupported,
  isStandalone,
  permissionState,
  subscribeToPush,
  VAPID_PUBLIC_KEY,
} from "@/lib/push";

const DISMISS_KEY = "push-prompt-dismissed";
export const PROPOSED_KEY = "has-proposed-candidate";

/**
 * 通知許可のソフトプロンプト（設計書 7.5）。
 *
 * ブラウザの許可ダイアログは一度拒否されると再要求できない。
 * だから初回起動時には出さず、「通知の価値が伝わった瞬間」——
 * 家族が2人以上いる、または自分が候補を提案した直後——にだけ、
 * まず自前のカードを見せて、「オンにする」を押した人にだけダイアログを出す。
 */
export function PushSoftPrompt() {
  const { user, members } = useSession();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPushSupported() || !VAPID_PUBLIC_KEY) return;
    if (permissionState() !== "default") return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    // iOS はホーム画面に追加しないとそもそも許可を出せない
    if (isIOS() && !isStandalone()) return;

    const hasProposed = localStorage.getItem(PROPOSED_KEY) === "1";
    if (members.length >= 2 || hasProposed) setVisible(true);
  }, [members.length]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await subscribeToPush(supabase, user.id);
      localStorage.setItem(DISMISS_KEY, "1");
      setVisible(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "通知を有効にできませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative mb-4 rounded-lg border border-primary/40 bg-accent p-4">
      <button
        type="button"
        aria-label="閉じる"
        onClick={dismiss}
        className="absolute right-2 top-2 p-1 text-accent-foreground"
      >
        <X className="size-4" />
      </button>
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="flex-1">
          <p className="pr-6 text-sm font-medium text-accent-foreground">
            家族の返事を通知で受け取りますか？
          </p>
          <p className="mt-1 text-xs text-accent-foreground">
            献立の相談はお互いの空き時間に進みます。通知があると、返事に気付いて話が前に進みます。
          </p>
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={enable} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              オンにする
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              あとで
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
