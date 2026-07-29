-- =============================================================================
-- Push のまとめ配信ワーカー（設計書 7.2 / 7.3）
--
--   pg_cron が1分ごとに dispatch_push_notifications() を呼ぶ。
--   5分以上バッファされた通知を (recipient_id, actor_id, type) でまとめ、
--   pg_net で Edge Function `send-push` を1回だけ叩く。
--
--   ※ 設計書では静かな時間帯の判定を Edge Function 側に置いているが、
--     受信者ごとの timezone / quiet_hours を持っているのは DB 側なので、
--     ここで判定して 'skipped' に落とす。外部送信の回数も減らせる。
-- =============================================================================

-- pg_net は net スキーマ、pg_cron は cron スキーマに入る（Supabase の既定）
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 5分バッファ。変更したい場合はこの関数だけ差し替える。
create or replace function public.push_buffer_interval()
returns interval language sql immutable as $$ select interval '5 minutes' $$;

-- 受信者のローカル時刻が静かな時間帯かどうか
create or replace function public.is_quiet_hours(p_user_id uuid, p_at timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  np public.notification_preferences;
  v_local time;
begin
  select * into np from public.notification_preferences where user_id = p_user_id;
  if np.user_id is null then
    return false;
  end if;

  v_local := (p_at at time zone np.timezone)::time;

  if np.quiet_hours_start = np.quiet_hours_end then
    return false;
  elsif np.quiet_hours_start < np.quiet_hours_end then
    return v_local >= np.quiet_hours_start and v_local < np.quiet_hours_end;
  else
    -- 22:00〜07:00 のように日をまたぐ場合
    return v_local >= np.quiet_hours_start or v_local < np.quiet_hours_end;
  end if;
end;
$$;

-- まとめ配信の本体 -------------------------------------------------------------
create or replace function public.dispatch_push_notifications()
returns int language plpgsql security definer set search_path = public, net, extensions as $$
declare
  v_url      text;
  v_key      text;
  v_payload  jsonb;
  v_groups   int := 0;
  v_ids      uuid[];
begin
  -- Edge Function の呼び出し情報は Vault から読む（migration 実行後に登録する）
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'send_push_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise notice 'send_push_url / service_role_key が Vault に未登録のためスキップします';
    return 0;
  end if;

  -- 1) 静かな時間帯の分は送らずに skipped へ（アプリ内通知としては残る）
  update public.notifications n
     set push_status = 'skipped'
   where n.push_status = 'buffered'
     and n.created_at < now() - public.push_buffer_interval()
     and public.is_quiet_hours(n.recipient_id);

  -- 2) 残りを (recipient_id, actor_id, type) でまとめる
  --    2件以上は「3件の候補を追加しました」形式に集約する
  with due as (
    select *
    from public.notifications
    where push_status = 'buffered'
      and created_at < now() - public.push_buffer_interval()
    order by created_at
  ),
  grouped as (
    select
      recipient_id,
      actor_id,
      type,
      count(*)                              as cnt,
      array_agg(id)                         as ids,
      (array_agg(title order by created_at desc))[1]     as title,
      (array_agg(body order by created_at desc))[1]      as body,
      (array_agg(link_path order by created_at desc))[1] as link_path,
      (array_agg(entity_id order by created_at desc))[1] as entity_id
    from due
    group by recipient_id, actor_id, type
  )
  select jsonb_agg(jsonb_build_object(
      'recipient_id', g.recipient_id,
      'title',        g.title,
      'body',         case when g.cnt = 1 then g.body
                           else format('%sから%s件のお知らせがあります',
                                       coalesce(p.display_name, '家族'), g.cnt) end,
      'link_path',    case when g.cnt = 1 then g.link_path else '/notifications' end,
      -- 同一タグの通知は端末側で置き換わる（通知トレイに積み上がらない）
      'tag',          g.type || ':' || coalesce(g.actor_id::text, 'system'),
      'ids',          to_jsonb(g.ids)
    ))
  into v_payload
  from grouped g
  left join public.profiles p on p.id = g.actor_id;

  if v_payload is null then
    return 0;
  end if;

  v_groups := jsonb_array_length(v_payload);

  -- ペイロードに含めた通知IDを平坦化して回収する
  select array_agg(elem::uuid) into v_ids
  from jsonb_array_elements(v_payload) grp,
       jsonb_array_elements_text(grp->'ids') elem;

  -- 3) 送信前に sent へ更新する（at-most-once。二重通知の方が体験を損なうため）
  update public.notifications
     set push_status = 'sent', push_sent_at = now()
   where id = any(v_ids);

  -- 4) Edge Function を非同期に呼ぶ
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := jsonb_build_object('notifications', v_payload),
    timeout_milliseconds := 10000
  );

  return v_groups;
end;
$$;

-- 1分ごとに実行 ---------------------------------------------------------------
-- 既存ジョブがあれば作り直す（マイグレーションの再実行に耐えるように）
do $$
begin
  perform cron.unschedule('dispatch-push-notifications');
exception when others then
  null;
end $$;

select cron.schedule(
  'dispatch-push-notifications',
  '* * * * *',
  $$ select public.dispatch_push_notifications() $$
);

-- =============================================================================
-- N5: 未投票リマインド（既定オフ・1日1回）
-- =============================================================================

create or replace function public.enqueue_plan_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select
      p.household_id,
      m.user_id,
      count(distinct e.id) as pending
    from public.meal_plans p
    join public.meal_plan_entries e on e.meal_plan_id = p.id and e.status = 'candidate'
    join public.household_members m on m.household_id = p.household_id
    join public.notification_preferences np on np.user_id = m.user_id
    left join public.meal_votes v on v.entry_id = e.id and v.user_id = m.user_id
    where p.week_start_date >= current_date - 7
      and e.date >= current_date
      and v.user_id is null
      and 'plan_reminder' = any(np.enabled_types)
      -- 直近24時間に同じリマインドを送っていない
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = m.user_id
          and n.type = 'plan_reminder'
          and n.created_at > now() - interval '24 hours'
      )
    group by p.household_id, m.user_id
  loop
    insert into public.notifications (
      household_id, recipient_id, actor_id, type, title, body, link_path, entity_type, push_status
    ) values (
      r.household_id, r.user_id, null, 'plan_reminder',
      '献立の相談が待っています',
      format('今週の献立に%s件の候補が待っています', r.pending),
      '/plan', 'meal_plan', 'buffered'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 毎日 18:00 JST（= 09:00 UTC）
do $$
begin
  perform cron.unschedule('enqueue-plan-reminders');
exception when others then
  null;
end $$;

select cron.schedule(
  'enqueue-plan-reminders',
  '0 9 * * *',
  $$ select public.enqueue_plan_reminders() $$
);
