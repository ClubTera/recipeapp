-- =============================================================================
-- 家族レシピ共有アプリ — 初期スキーマ
-- 設計書 4章（データモデル） / 5章（RLS）に対応
-- =============================================================================

create extension if not exists "pg_trgm";
create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. プロフィール・世帯
-- =============================================================================

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '名無し',
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on public.household_members(user_id);

-- =============================================================================
-- 2. レシピ
-- =============================================================================

create table public.recipes (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  title             text not null,                      -- 唯一の必須項目
  source_type       text not null default 'original'
                    check (source_type in ('web','youtube','tiktok','x','instagram','original')),
  source_url        text,
  source_site_name  text,
  source_author     text,
  image_url         text,
  description       text,
  servings          text,                               -- 「2人分」など単位が多様なので text
  cook_time_minutes int,
  memo              text,                               -- 家族用メモ
  is_favorite       boolean not null default false,
  created_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  raw_metadata      jsonb                               -- 取得した生データ（後から再解析できるように）
);

create index recipes_household_created_idx on public.recipes(household_id, created_at desc);
create index recipes_title_trgm_idx on public.recipes using gin (title gin_trgm_ops);

create table public.recipe_ingredients (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  group_name text,                     -- 「タレ」「衣」等のグループ見出し
  raw_text   text not null,            -- 入力そのまま。これが正
  name       text,                     -- 正規化後の材料名
  quantity   numeric,
  unit       text,
  sort_order int not null default 0
);

create index recipe_ingredients_recipe_idx on public.recipe_ingredients(recipe_id, sort_order);
create index recipe_ingredients_name_trgm_idx on public.recipe_ingredients using gin (raw_text gin_trgm_ops);

create table public.recipe_steps (
  id        uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  step_no   int not null,
  body      text not null,
  image_url text
);

create index recipe_steps_recipe_idx on public.recipe_steps(recipe_id, step_no);

create table public.tags (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null,
  color        text not null default 'slate',
  unique (household_id, name)
);

create table public.recipe_tags (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  tag_id    uuid not null references public.tags(id) on delete cascade,
  primary key (recipe_id, tag_id)
);

create table public.cooking_logs (
  id        uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  cooked_on date not null default current_date,
  cooked_by uuid not null references public.profiles(id),
  rating    int check (rating between 1 and 5),
  note      text
);

create index cooking_logs_recipe_idx on public.cooking_logs(recipe_id, cooked_on desc);

-- =============================================================================
-- 3. 献立
-- =============================================================================

create table public.meal_plans (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  week_start_date date not null,               -- 月曜日
  created_at      timestamptz not null default now(),
  unique (household_id, week_start_date)
);

create table public.meal_plan_entries (
  id           uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null references public.meal_plans(id) on delete cascade,
  date         date not null,
  meal_slot    text not null check (meal_slot in ('breakfast','lunch','dinner')),
  recipe_id    uuid references public.recipes(id) on delete set null,
  free_text    text,                           -- 「外食」「残り物」等
  status       text not null default 'candidate'
               check (status in ('candidate','confirmed','archived')),
  added_by     uuid not null references public.profiles(id),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- レシピか自由入力のどちらかは必ず埋まっている
  constraint meal_entry_has_content check (recipe_id is not null or nullif(btrim(free_text), '') is not null)
);

create index meal_plan_entries_plan_idx on public.meal_plan_entries(meal_plan_id, date, meal_slot);

create table public.meal_votes (
  entry_id   uuid not null references public.meal_plan_entries(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  value      text not null check (value in ('want','pass')),
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);

create table public.meal_comments (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.meal_plan_entries(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index meal_comments_entry_idx on public.meal_comments(entry_id, created_at);

-- =============================================================================
-- 4. 買い物リスト
-- =============================================================================

create table public.shopping_lists (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households(id) on delete cascade,
  name                 text not null,
  source_meal_plan_id  uuid references public.meal_plans(id) on delete set null,
  status               text not null default 'active' check (status in ('active','done')),
  created_by           uuid not null references public.profiles(id),
  created_at           timestamptz not null default now()
);

create index shopping_lists_household_idx on public.shopping_lists(household_id, created_at desc);

create table public.shopping_list_items (
  id                uuid primary key default gen_random_uuid(),
  list_id           uuid not null references public.shopping_lists(id) on delete cascade,
  name              text not null,
  quantity          numeric,
  unit              text,
  display_text      text not null,        -- 「玉ねぎ 1.5個」など画面表示用
  category          text not null default 'other'
                    check (category in ('vegetable','meat_fish','dairy','seasoning','other')),
  is_checked        boolean not null default false,
  checked_by        uuid references public.profiles(id),
  checked_at        timestamptz,
  source_recipe_ids uuid[] not null default '{}',
  added_by          uuid not null references public.profiles(id),
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);

create index shopping_list_items_list_idx on public.shopping_list_items(list_id, category, sort_order);

-- 材料名正規化マスタ（システム共通・世帯をまたいで共有）
create table public.ingredient_aliases (
  alias          text primary key,
  canonical_name text not null,
  category       text not null default 'other'
                 check (category in ('vegetable','meat_fish','dairy','seasoning','other'))
);

-- =============================================================================
-- 5. 通知
-- =============================================================================

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id     uuid references public.profiles(id) on delete set null,
  type         text not null check (type in (
                 'meal_candidate_added','meal_vote','meal_comment','meal_confirmed',
                 'plan_reminder','shopping_list_created','shopping_done','member_joined')),
  title        text not null,
  body         text not null,
  link_path    text not null default '/',
  entity_type  text,
  entity_id    uuid,
  read_at      timestamptz,
  push_status  text not null default 'buffered'
               check (push_status in ('pending','buffered','sent','skipped','failed')),
  push_sent_at timestamptz,
  created_at   timestamptz not null default now()
);

create index notifications_recipient_idx on public.notifications(recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications(recipient_id) where read_at is null;
create index notifications_pending_push_idx on public.notifications(push_status, created_at)
  where push_status in ('pending','buffered');

create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  last_success_at timestamptz,
  failure_count   int not null default 0,
  created_at      timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table public.notification_preferences (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  -- 既定: N1〜N4・N6 と N8 がオン、N5(plan_reminder)・N7(shopping_done) はオフ
  enabled_types     text[] not null default array[
                      'meal_candidate_added','meal_vote','meal_comment',
                      'meal_confirmed','shopping_list_created','member_joined'],
  quiet_hours_start time not null default '22:00',
  quiet_hours_end   time not null default '07:00',
  timezone          text not null default 'Asia/Tokyo'
);

-- =============================================================================
-- 6. 共通トリガー（updated_at）
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

create trigger meal_plan_entries_set_updated_at
  before update on public.meal_plan_entries
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 7. サインアップ時のプロフィール自動作成
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name', ''),
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      split_part(coalesce(new.email, 'user'), '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- 8. 世帯まわりのヘルパー / RPC
-- =============================================================================

-- 所属世帯の判定。ポリシーの再帰評価を避けるため SECURITY DEFINER。
create or replace function public.my_household_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select household_id from public.household_members where user_id = auth.uid()
$$;

-- 紛らわしい文字（0/O/1/I など）を除いた8文字の招待コード
create or replace function public.generate_invite_code()
returns text language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code  text;
  i     int;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.households where invite_code = code);
  end loop;
  return code;
end;
$$;

-- 世帯を作成して自分を owner として参加させる
create or replace function public.create_household(p_name text)
returns public.households
language plpgsql security definer set search_path = public as $$
declare
  v_household public.households;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception '世帯名を入力してください';
  end if;

  insert into public.households (name, invite_code, created_by)
  values (btrim(p_name), public.generate_invite_code(), auth.uid())
  returning * into v_household;

  insert into public.household_members (household_id, user_id, role)
  values (v_household.id, auth.uid(), 'owner');

  return v_household;
end;
$$;

-- 招待コードで参加する。未参加ユーザーに households を直接 SELECT させないため RPC 経由。
create or replace function public.join_household(p_code text)
returns public.households
language plpgsql security definer set search_path = public as $$
declare
  v_household public.households;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into v_household
  from public.households
  where invite_code = upper(btrim(p_code));

  if v_household.id is null then
    raise exception '招待コードが見つかりません';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_household.id, auth.uid(), 'member')
  on conflict do nothing;

  return v_household;
end;
$$;

-- 招待コードを再発行（owner のみ）
create or replace function public.regenerate_invite_code(p_household_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'owner のみ実行できます';
  end if;

  v_code := public.generate_invite_code();
  update public.households set invite_code = v_code where id = p_household_id;
  return v_code;
end;
$$;

-- =============================================================================
-- 9. RLS
--    方針: 「自分が所属する世帯のデータのみ」という一貫した規則
-- =============================================================================

alter table public.profiles                enable row level security;
alter table public.households              enable row level security;
alter table public.household_members       enable row level security;
alter table public.recipes                 enable row level security;
alter table public.recipe_ingredients      enable row level security;
alter table public.recipe_steps            enable row level security;
alter table public.tags                    enable row level security;
alter table public.recipe_tags             enable row level security;
alter table public.cooking_logs            enable row level security;
alter table public.meal_plans              enable row level security;
alter table public.meal_plan_entries       enable row level security;
alter table public.meal_votes              enable row level security;
alter table public.meal_comments           enable row level security;
alter table public.shopping_lists          enable row level security;
alter table public.shopping_list_items     enable row level security;
alter table public.ingredient_aliases      enable row level security;
alter table public.notifications           enable row level security;
alter table public.push_subscriptions      enable row level security;
alter table public.notification_preferences enable row level security;

-- profiles: 同じ世帯のメンバーは互いのプロフィールを見られる
create policy "profiles_select_household" on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1 from public.household_members m
      where m.user_id = profiles.id and m.household_id in (select public.my_household_ids())
    )
  );

create policy "profiles_update_own" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles_insert_own" on public.profiles for insert
  with check (id = auth.uid());

-- households
create policy "households_select_own" on public.households for select
  using (id in (select public.my_household_ids()));

create policy "households_update_owner" on public.households for update
  using (exists (
    select 1 from public.household_members m
    where m.household_id = households.id and m.user_id = auth.uid() and m.role = 'owner'
  ));

create policy "households_delete_owner" on public.households for delete
  using (exists (
    select 1 from public.household_members m
    where m.household_id = households.id and m.user_id = auth.uid() and m.role = 'owner'
  ));

-- household_members: 自分の行は直接、他人の行は SECURITY DEFINER 関数経由で判定（再帰回避）
create policy "members_select" on public.household_members for select
  using (user_id = auth.uid() or household_id in (select public.my_household_ids()));

create policy "members_delete" on public.household_members for delete
  using (
    user_id = auth.uid()  -- 自分で抜ける
    or exists (
      select 1 from public.household_members m
      where m.household_id = household_members.household_id
        and m.user_id = auth.uid() and m.role = 'owner'
    )
  );

-- 参加は join_household / create_household（SECURITY DEFINER）経由のみ。直接 insert は許可しない。

-- 世帯配下のテーブル用ポリシーをまとめて生成する
do $$
declare
  t text;
begin
  foreach t in array array['recipes','tags','meal_plans','shopping_lists'] loop
    execute format($f$
      create policy "select_own_household" on public.%1$I for select
        using (household_id in (select public.my_household_ids()));
      create policy "insert_own_household" on public.%1$I for insert
        with check (household_id in (select public.my_household_ids()));
      create policy "update_own_household" on public.%1$I for update
        using (household_id in (select public.my_household_ids()))
        with check (household_id in (select public.my_household_ids()));
      create policy "delete_own_household" on public.%1$I for delete
        using (household_id in (select public.my_household_ids()));
    $f$, t);
  end loop;
end $$;

-- recipes の子テーブル: 親を辿って判定
do $$
declare
  t text;
begin
  foreach t in array array['recipe_ingredients','recipe_steps','cooking_logs','recipe_tags'] loop
    execute format($f$
      create policy "all_via_recipe" on public.%1$I for all
        using (exists (
          select 1 from public.recipes r
          where r.id = %1$I.recipe_id and r.household_id in (select public.my_household_ids())
        ))
        with check (exists (
          select 1 from public.recipes r
          where r.id = %1$I.recipe_id and r.household_id in (select public.my_household_ids())
        ));
    $f$, t);
  end loop;
end $$;

-- meal_plan_entries: meal_plans を辿る
create policy "entries_all_via_plan" on public.meal_plan_entries for all
  using (exists (
    select 1 from public.meal_plans p
    where p.id = meal_plan_id and p.household_id in (select public.my_household_ids())
  ))
  with check (exists (
    select 1 from public.meal_plans p
    where p.id = meal_plan_id and p.household_id in (select public.my_household_ids())
  ));

-- meal_votes / meal_comments: entry → plan を辿る。書き込みは本人の行のみ。
create policy "votes_select_via_entry" on public.meal_votes for select
  using (exists (
    select 1 from public.meal_plan_entries e join public.meal_plans p on p.id = e.meal_plan_id
    where e.id = entry_id and p.household_id in (select public.my_household_ids())
  ));

create policy "votes_write_own" on public.meal_votes for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.meal_plan_entries e join public.meal_plans p on p.id = e.meal_plan_id
      where e.id = entry_id and p.household_id in (select public.my_household_ids())
    )
  );

create policy "comments_select_via_entry" on public.meal_comments for select
  using (exists (
    select 1 from public.meal_plan_entries e join public.meal_plans p on p.id = e.meal_plan_id
    where e.id = entry_id and p.household_id in (select public.my_household_ids())
  ));

create policy "comments_write_own" on public.meal_comments for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.meal_plan_entries e join public.meal_plans p on p.id = e.meal_plan_id
      where e.id = entry_id and p.household_id in (select public.my_household_ids())
    )
  );

-- shopping_list_items: shopping_lists を辿る
create policy "items_all_via_list" on public.shopping_list_items for all
  using (exists (
    select 1 from public.shopping_lists l
    where l.id = list_id and l.household_id in (select public.my_household_ids())
  ))
  with check (exists (
    select 1 from public.shopping_lists l
    where l.id = list_id and l.household_id in (select public.my_household_ids())
  ));

-- ingredient_aliases: 全員読み取り専用のマスタ
create policy "aliases_select_all" on public.ingredient_aliases for select
  using (auth.role() = 'authenticated');

-- 通知（設計書 7.6）
create policy "notifications_select_own" on public.notifications for select
  using (recipient_id = auth.uid());

create policy "notifications_update_own_read" on public.notifications for update
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create policy "notifications_delete_own" on public.notifications for delete
  using (recipient_id = auth.uid());
-- insert はトリガー（SECURITY DEFINER）からのみ。クライアントには許可しない。

create policy "push_subscriptions_manage_own" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "notification_preferences_manage_own" on public.notification_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =============================================================================
-- 10. Realtime
-- =============================================================================

alter publication supabase_realtime add table public.meal_plan_entries;
alter publication supabase_realtime add table public.meal_votes;
alter publication supabase_realtime add table public.meal_comments;
alter publication supabase_realtime add table public.shopping_list_items;
alter publication supabase_realtime add table public.shopping_lists;
alter publication supabase_realtime add table public.notifications;

-- =============================================================================
-- 11. Storage（自作レシピ画像）
--     パスに household_id を含めて世帯単位で制御する: {household_id}/{recipe_id}/xxx.jpg
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', true)
on conflict (id) do nothing;

create policy "recipe_images_read" on storage.objects for select
  using (bucket_id = 'recipe-images');

create policy "recipe_images_insert" on storage.objects for insert
  with check (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1]::uuid in (select public.my_household_ids())
  );

create policy "recipe_images_update" on storage.objects for update
  using (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1]::uuid in (select public.my_household_ids())
  );

create policy "recipe_images_delete" on storage.objects for delete
  using (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1]::uuid in (select public.my_household_ids())
  );
