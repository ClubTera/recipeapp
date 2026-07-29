import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractMetadata } from "@/lib/metadata";
import type { ExtractedMetadata } from "@/lib/types";

export const runtime = "nodejs";

/**
 * URL からメタ情報を取得する唯一のサーバー経路（設計書 3.1）。
 * ブラウザから外部サイトを直接 fetch すると CORS で落ちるため、ここを通す。
 *
 * 取得失敗は 200 + warning で返す。エラーにするとユーザーが保存を諦めてしまう。
 */

type CacheEntry = { at: number; data: ExtractedMetadata };
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 同一URLは24時間キャッシュ（相手サイトへの負荷対策）
const cache = new Map<string, CacheEntry>();

export async function POST(request: NextRequest) {
  // 認証済みユーザーだけが使える（外部fetchの踏み台にされないように）
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let url: string;
  try {
    const body = (await request.json()) as { url?: string };
    url = (body.url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "URLの形式が正しくありません" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "http(s) のURLのみ対応しています" }, { status: 400 });
  }
  if (isPrivateHost(parsed.hostname)) {
    return NextResponse.json({ error: "このURLは取得できません" }, { status: 400 });
  }

  const key = parsed.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.data, { headers: { "X-Cache": "HIT" } });
  }

  const data = await extractMetadata(key);

  // 何も取れなかったものをキャッシュしても意味がない
  if (data.title) {
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
  }

  return NextResponse.json(data, {
    headers: {
      "X-Cache": "MISS",
      "Cache-Control": "private, max-age=0, s-maxage=86400",
    },
  });
}

/** SSRF 対策: 内部ネットワーク宛のURLは弾く */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "0.0.0.0" || h === "[::1]" || h === "::1") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}
