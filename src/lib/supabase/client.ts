"use client";

import { createBrowserClient } from "@supabase/ssr";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const hasSupabaseEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let cached: ReturnType<typeof createBrowserClient> | null = null;

/**
 * ブラウザ用 Supabase クライアント（シングルトン）。
 * Realtime の購読をページ間で共有したいので毎回作り直さない。
 */
export function createClient() {
  if (!hasSupabaseEnv) {
    throw new Error(
      "Supabase の環境変数が設定されていません。.env.local に NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。",
    );
  }
  cached ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}
