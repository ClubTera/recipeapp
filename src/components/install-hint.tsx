"use client";

import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";
import { isIOS, isStandalone } from "@/lib/push";

const DISMISS_KEY = "install-hint-dismissed";

/**
 * iOS の「ホーム画面に追加」案内（設計書 8章）。
 * これは見た目の話ではなく、iOS で Web Push を受け取るための前提条件でもある。
 */
export function InstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const ios = isIOS();

  return (
    <div className="relative rounded-lg border border-primary/40 bg-accent p-4 text-accent-foreground">
      <button
        type="button"
        aria-label="閉じる"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setVisible(false);
        }}
        className="absolute right-2 top-2 p-1"
      >
        <X className="size-4" />
      </button>
      <p className="pr-6 text-sm font-medium">ホーム画面に追加すると使いやすくなります</p>
      {ios ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
          Safari の共有ボタン
          <Share className="inline size-3.5" />
          から「ホーム画面に追加」を選んでください。
          <span className="font-medium">iPhone では、これをしないと通知を受け取れません。</span>
        </p>
      ) : (
        <p className="mt-1.5 text-xs">
          ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。
        </p>
      )}
    </div>
  );
}
