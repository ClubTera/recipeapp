/**
 * Edge Function: send-push
 *
 * pg_cron から呼ばれ、まとめ済みの通知を各端末へ配信する（設計書 7.2）。
 * DB 側で既に push_status = 'sent' に更新済み（at-most-once）なので、
 * ここでの失敗は failed への戻しと購読の掃除だけを行う。
 *
 * デプロイ:
 *   supabase functions deploy send-push --no-verify-jwt
 *   supabase secrets set VAPID_PRIVATE_KEY=... VAPID_PUBLIC_KEY=... VAPID_SUBJECT=mailto:you@example.com
 */
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Group = {
  recipient_id: string;
  title: string;
  body: string;
  link_path: string;
  tag: string;
  ids: string[];
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// service_role キーは RLS をバイパスして全受信者の購読情報を読むために必要。
// サーバー側（Edge Function Secrets）にのみ置くこと。
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  // pg_cron 以外から叩かれないよう service_role キーを確認する
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  let groups: Group[] = [];
  try {
    const body = await req.json();
    groups = body.notifications ?? [];
  } catch {
    return new Response(JSON.stringify({ error: "invalid body" }), { status: 400 });
  }
  if (groups.length === 0) {
    return Response.json({ sent: 0 });
  }

  const recipientIds = [...new Set(groups.map((g) => g.recipient_id))];
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("*")
    .in("user_id", recipientIds);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let sent = 0;
  let failed = 0;

  for (const group of groups) {
    // 1ユーザーが複数端末を持つ前提で、全端末に送る
    const targets = (subscriptions ?? []).filter((s) => s.user_id === group.recipient_id);
    if (targets.length === 0) {
      await markFailed(group.ids, "no_subscription");
      continue;
    }

    const payload = JSON.stringify({
      title: group.title,
      body: group.body,
      link_path: group.link_path,
      tag: group.tag,
    });

    const results = await Promise.all(
      targets.map((sub) =>
        webpush
          .sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
            { TTL: 3600 },
          )
          .then(() => ({ ok: true as const, sub }))
          .catch((err: { statusCode?: number; message?: string }) => ({
            ok: false as const,
            sub,
            statusCode: err?.statusCode ?? 0,
            message: err?.message ?? "unknown",
          })),
      ),
    );

    for (const result of results) {
      if (result.ok) {
        sent += 1;
        await supabase
          .from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq("id", result.sub.id);
        continue;
      }

      failed += 1;
      // 404 / 410 は購読解除済み。放置すると毎回エラーが積み上がるので即削除する。
      if (result.statusCode === 404 || result.statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", result.sub.id);
      } else {
        // 429 / 5xx は一時的な失敗。3回連続で失敗したものだけ無効化する。
        const nextCount = (result.sub.failure_count ?? 0) + 1;
        if (nextCount >= 3) {
          await supabase.from("push_subscriptions").delete().eq("id", result.sub.id);
        } else {
          await supabase
            .from("push_subscriptions")
            .update({ failure_count: nextCount })
            .eq("id", result.sub.id);
        }
      }
    }

    if (results.every((r) => !r.ok)) {
      await markFailed(group.ids, "all_endpoints_failed");
    }
  }

  return Response.json({ groups: groups.length, sent, failed });
});

async function markFailed(ids: string[], _reason: string) {
  if (ids.length === 0) return;
  await supabase.from("notifications").update({ push_status: "failed" }).in("id", ids);
}
