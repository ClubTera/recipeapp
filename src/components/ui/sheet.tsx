"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * モバイルではボトムシート、PCでは中央のダイアログとして出す共通コンテナ。
 * 献立のスロット詳細やレシピ検索モーダルで使う（設計書 6.1）。
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl",
          "sm:max-w-lg sm:rounded-2xl",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 text-base font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
