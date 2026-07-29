-- =============================================================================
-- 通知の生成（設計書 7.2）
--   トリガーの仕事は notifications への insert のみ。
--   文面生成の重い処理と外部送信（Push）はワーカー側に寄せる。
-- =============================================================================

-- 表示用の小さなヘルパー -------------------------------------------------------

create or replace function public.jp_date_label(p_date date)
returns text language sql immutable as $$
  select to_char(p_date, 'FMMM/FMDD') || '(' ||
         (array['日','月','火','水','木','金','土'])[extract(dow from p_date)::int + 1] || ')'
$$;

create or replace function public.jp_slot_label(p_slot text)
returns text language sql immutable as $$
  select case p_slot
    when 'breakfast' then '朝食'
    when 'lunch'     then '昼食'
    when 'dinner'    then '夕食'
    else p_slot end
$$;

-- meal_plan_entries の表示名（レシピ名 or 自由入力）
create or replace function public.entry_label(p_entry public.meal_plan_entries)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.title from public.recipes r where r.id = p_entry.recipe_id),
    nullif(btrim(p_entry.free_text), ''),
    'メニュー'
  )
$$;

-- 通知の一括作成 ---------------------------------------------------------------
-- p_recipients が null の場合は「actor 以外の世帯メンバー全員」が対象。
-- 通知種別をオフにしている人はここで除外する。
create or replace function public.create_notifications(
  p_household_id uuid,
  p_actor_id     uuid,
  p_type         text,
  p_title        text,
  p_body         text,
  p_link_path    text,
  p_entity_type  text,
  p_entity_id    uuid,
  p_recipients   uuid[] default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  insert into public.notifications (
    household_id, recipient_id, actor_id, type, title, body,
    link_path, entity_type, entity_id, push_status
  )
  select
    p_household_id, m.user_id, p_actor_id, p_type, p_title, p_body,
    p_link_path, p_entity_type, p_entity_id, 'buffered'
  from public.household_members m
  left join public.notification_preferences np on np.user_id = m.user_id
  where m.household_id = p_household_id
    -- 自分の操作は自分に通知しない
    and m.user_id is distinct from p_actor_id
    and (p_recipients is null or m.user_id = any(p_recipients))
    -- 設定行が無い場合は既定でオンとみなす
    and (np.user_id is null or p_type = any(np.enabled_types));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- N1: 献立に候補が追加された ---------------------------------------------------

create or replace function public.notify_meal_candidate_added()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_household_id uuid;
  v_actor_name   text;
  v_label        text;
begin
  select p.household_id into v_household_id
  from public.meal_plans p where p.id = new.meal_plan_id;

  select display_name into v_actor_name from public.profiles where id = new.added_by;
  v_label := public.entry_label(new);

  perform public.create_notifications(
    v_household_id,
    new.added_by,
    'meal_candidate_added',
    '献立の新しい候補',
    format('%sが %sの%s に「%s」を提案しました',
           coalesce(v_actor_name, '家族'),
           public.jp_date_label(new.date),
           public.jp_slot_label(new.meal_slot),
           v_label),
    format('/plan/%s/%s', to_char(new.date, 'YYYY-MM-DD'), new.meal_slot),
    'meal_plan_entry',
    new.id
  );
  return new;
end;
$$;

create trigger meal_plan_entries_notify_added
  after insert on public.meal_plan_entries
  for each row when (new.status = 'candidate')
  execute function public.notify_meal_candidate_added();

-- N4: 献立が確定した -----------------------------------------------------------
-- 確定したエントリと同じスロットの他候補は archived に落とす。

create or replace function public.notify_meal_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_household_id uuid;
  v_actor_name   text;
  v_label        text;
begin
  if new.status <> 'confirmed' or old.status = 'confirmed' then
    return new;
  end if;

  select p.household_id into v_household_id
  from public.meal_plans p where p.id = new.meal_plan_id;

  select display_name into v_actor_name from public.profiles where id = auth.uid();
  v_label := public.entry_label(new);

  perform public.create_notifications(
    v_household_id,
    auth.uid(),
    'meal_confirmed',
    '献立が決まりました',
    format('%sの%sは「%s」に決まりました',
           public.jp_date_label(new.date),
           public.jp_slot_label(new.meal_slot),
           v_label),
    format('/plan/%s/%s', to_char(new.date, 'YYYY-MM-DD'), new.meal_slot),
    'meal_plan_entry',
    new.id
  );
  return new;
end;
$$;

create trigger meal_plan_entries_notify_confirmed
  after update of status on public.meal_plan_entries
  for each row execute function public.notify_meal_confirmed();

-- 確定したら同スロットの他候補を自動アーカイブ
create or replace function public.archive_sibling_entries()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    update public.meal_plan_entries
       set status = 'archived'
     where meal_plan_id = new.meal_plan_id
       and date = new.date
       and meal_slot = new.meal_slot
       and id <> new.id
       and status = 'candidate';
  end if;
  return new;
end;
$$;

create trigger meal_plan_entries_archive_siblings
  after update of status on public.meal_plan_entries
  for each row execute function public.archive_sibling_entries();

-- N2: 自分が提案した候補に「食べたい」が付いた ---------------------------------

create or replace function public.notify_meal_vote()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entry        public.meal_plan_entries;
  v_household_id uuid;
  v_actor_name   text;
begin
  -- 通知するのは 👍 のみ（🙅 は通知しない: 気まずさを避ける）
  if new.value <> 'want' then
    return new;
  end if;

  select * into v_entry from public.meal_plan_entries where id = new.entry_id;
  select p.household_id into v_household_id from public.meal_plans p where p.id = v_entry.meal_plan_id;
  select display_name into v_actor_name from public.profiles where id = new.user_id;

  perform public.create_notifications(
    v_household_id,
    new.user_id,
    'meal_vote',
    '候補に反応がありました',
    format('%sが「%s」に👍しました', coalesce(v_actor_name, '家族'), public.entry_label(v_entry)),
    format('/plan/%s/%s', to_char(v_entry.date, 'YYYY-MM-DD'), v_entry.meal_slot),
    'meal_plan_entry',
    v_entry.id,
    array[v_entry.added_by]      -- 提案者にだけ届ける
  );
  return new;
end;
$$;

create trigger meal_votes_notify
  after insert or update of value on public.meal_votes
  for each row execute function public.notify_meal_vote();

-- N3: 候補にコメントが付いた ---------------------------------------------------
-- 宛先は「提案者 ＋ そのスレッドで発言済みの人」。

create or replace function public.notify_meal_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entry        public.meal_plan_entries;
  v_household_id uuid;
  v_actor_name   text;
  v_recipients   uuid[];
begin
  select * into v_entry from public.meal_plan_entries where id = new.entry_id;
  select p.household_id into v_household_id from public.meal_plans p where p.id = v_entry.meal_plan_id;
  select display_name into v_actor_name from public.profiles where id = new.user_id;

  select array_agg(distinct uid) into v_recipients
  from (
    select v_entry.added_by as uid
    union
    select c.user_id from public.meal_comments c where c.entry_id = new.entry_id
  ) s
  where uid is not null;

  perform public.create_notifications(
    v_household_id,
    new.user_id,
    'meal_comment',
    format('「%s」にコメント', public.entry_label(v_entry)),
    format('%s: %s', coalesce(v_actor_name, '家族'),
           left(new.body, 60) || case when length(new.body) > 60 then '…' else '' end),
    format('/plan/%s/%s', to_char(v_entry.date, 'YYYY-MM-DD'), v_entry.meal_slot),
    'meal_plan_entry',
    v_entry.id,
    v_recipients
  );
  return new;
end;
$$;

create trigger meal_comments_notify
  after insert on public.meal_comments
  for each row execute function public.notify_meal_comment();

-- N6: 買い物リストが作成された -------------------------------------------------
-- 品目数を含めたいので、items の投入後に呼ぶ RPC として実装する。

create or replace function public.notify_shopping_list_created(p_list_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_list       public.shopping_lists;
  v_actor_name text;
  v_count      int;
begin
  select * into v_list from public.shopping_lists where id = p_list_id;
  if v_list.id is null then
    return;
  end if;
  if not exists (
    select 1 from public.household_members
    where household_id = v_list.household_id and user_id = auth.uid()
  ) then
    raise exception 'permission denied';
  end if;

  select count(*) into v_count from public.shopping_list_items where list_id = p_list_id;
  select display_name into v_actor_name from public.profiles where id = v_list.created_by;

  perform public.create_notifications(
    v_list.household_id,
    v_list.created_by,
    'shopping_list_created',
    '買い物リストができました',
    format('%sが「%s」（%s品）を作成しました', coalesce(v_actor_name, '家族'), v_list.name, v_count),
    '/shopping',
    'shopping_list',
    v_list.id
  );
end;
$$;

-- N7: 買い物リストが全部チェックされた ----------------------------------------

create or replace function public.notify_shopping_done()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_list       public.shopping_lists;
  v_actor_name text;
  v_remaining  int;
begin
  if new.is_checked is not true or old.is_checked is true then
    return new;
  end if;

  select count(*) into v_remaining
  from public.shopping_list_items where list_id = new.list_id and is_checked = false;

  if v_remaining > 0 then
    return new;
  end if;

  select * into v_list from public.shopping_lists where id = new.list_id;
  select display_name into v_actor_name from public.profiles where id = new.checked_by;

  update public.shopping_lists set status = 'done' where id = new.list_id;

  perform public.create_notifications(
    v_list.household_id,
    new.checked_by,
    'shopping_done',
    '買い物が完了しました',
    format('%sが「%s」を買い終わりました', coalesce(v_actor_name, '家族'), v_list.name),
    '/shopping',
    'shopping_list',
    v_list.id
  );
  return new;
end;
$$;

create trigger shopping_list_items_notify_done
  after update of is_checked on public.shopping_list_items
  for each row execute function public.notify_shopping_done();

-- N8: 新しいメンバーが世帯に参加した -------------------------------------------

create or replace function public.notify_member_joined()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor_name text;
begin
  select display_name into v_actor_name from public.profiles where id = new.user_id;

  perform public.create_notifications(
    new.household_id,
    new.user_id,
    'member_joined',
    '新しいメンバー',
    format('%sさんが世帯に参加しました', coalesce(v_actor_name, '家族')),
    '/settings',
    'household',
    new.household_id
  );
  return new;
end;
$$;

create trigger household_members_notify_joined
  after insert on public.household_members
  for each row execute function public.notify_member_joined();

-- 既読操作用のヘルパー ---------------------------------------------------------

create or replace function public.mark_all_notifications_read()
returns int language plpgsql security invoker set search_path = public as $$
declare
  v_count int;
begin
  update public.notifications
     set read_at = now()
   where recipient_id = auth.uid() and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
