"use client";

import { useEffect } from "react";

/**
 * Service Worker の登録。
 * キャッシュ用とPush用でSWを分けることはできない（1スコープ1SW）ため、
 * public/sw.js の1本に集約している（設計書 8章）。
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return; // 開発中はキャッシュが邪魔になる

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
        console.warn("Service Worker の登録に失敗しました", err);
      });
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
