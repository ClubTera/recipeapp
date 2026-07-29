import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * マジックリンク / OAuth のコールバック。
 * 受け取った code をセッションに交換して、元居た画面へ戻す。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const errorDescription = searchParams.get("error_description");

  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription)}`,
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/"}`);
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}/login`);
}
