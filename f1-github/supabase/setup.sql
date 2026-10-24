-- ============================================================================
-- F1 Dashboard back office — รันไฟล์นี้ครั้งเดียวใน Supabase > SQL Editor (กด Run)
-- รันซ้ำได้ ไม่ทำให้ข้อมูลหาย
-- ============================================================================

-- 1) ตาราง ------------------------------------------------------------------
create table if not exists public.site_config (
  key        text primary key,                     -- 'settings' | 'news' | 'overrides'
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.page_stats (       -- ตัวนับรวมต่อวัน/ต่อหน้า ไม่เก็บ IP หรือข้อมูลผู้เข้าชมรายคน
  day    date not null default ((now() at time zone 'utc')::date),
  tab    text not null,
  views  int  not null default 0,
  visits int  not null default 0,
  primary key (day, tab)
);

create table if not exists public.audit_log (
  id       bigint generated always as identity primary key,
  ts       timestamptz not null default now(),
  username text,
  action   text not null,
  detail   text
);

create table if not exists public.admins (           -- ใครเป็นแอดมินบ้าง (อ้างอิงบัญชีใน Authentication)
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- 2) ฟังก์ชันตรวจสิทธิ์แอดมิน -------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 3) ฟังก์ชันนับยอดเข้าชม (ใครก็เรียกได้ แต่เพิ่มได้แค่ตัวนับรวม ไม่มีทางอ่านหรือแก้ข้อมูลอื่น)
create or replace function public.hit(p_tab text, p_visit boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_tab not in ('overview','live','calendar','race','drivers','constructors','circuits','stats','f2','f3') then
    return;
  end if;
  insert into public.page_stats (day, tab, views, visits)
  values ((now() at time zone 'utc')::date, p_tab, 1, case when p_visit then 1 else 0 end)
  on conflict (day, tab) do update
    set views  = public.page_stats.views  + 1,
        visits = public.page_stats.visits + case when p_visit then 1 else 0 end;
end $$;
revoke all on function public.hit(text, boolean) from public;
grant execute on function public.hit(text, boolean) to anon, authenticated;

-- 4) Row Level Security (หัวใจความปลอดภัย: เปิดทุกตาราง) ----------------------
alter table public.site_config enable row level security;
alter table public.page_stats  enable row level security;
alter table public.audit_log   enable row level security;
alter table public.admins      enable row level security;

drop policy if exists "config: public read"  on public.site_config;
drop policy if exists "config: admin write"  on public.site_config;
drop policy if exists "stats: admin read"    on public.page_stats;
drop policy if exists "audit: admin read"    on public.audit_log;
drop policy if exists "audit: admin insert"  on public.audit_log;
drop policy if exists "admins: read self"    on public.admins;

create policy "config: public read" on public.site_config for select using (true);
create policy "config: admin write" on public.site_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "stats: admin read"   on public.page_stats  for select to authenticated using (public.is_admin());
create policy "audit: admin read"   on public.audit_log   for select to authenticated using (public.is_admin());
create policy "audit: admin insert" on public.audit_log   for insert to authenticated with check (public.is_admin());
create policy "admins: read self"   on public.admins      for select to authenticated using (user_id = auth.uid());

-- 5) สิทธิ์ระดับตาราง (ซ้อนกับ RLS อีกชั้น) -------------------------------------
revoke all on public.site_config, public.page_stats, public.audit_log, public.admins from anon, authenticated;
grant select on public.site_config to anon, authenticated;
grant insert, update, delete on public.site_config to authenticated;
grant select on public.page_stats to authenticated;
grant select, insert on public.audit_log to authenticated;
grant select on public.admins to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 6) ค่าเริ่มต้น --------------------------------------------------------------
insert into public.site_config (key, value) values
  ('settings',  '{}'::jsonb),
  ('news',      '[]'::jsonb),
  ('overrides', '{}'::jsonb)
on conflict (key) do nothing;

-- ============================================================================
-- 7) ทำให้บัญชีของคุณเป็นแอดมิน  (ทำ "หลัง" สร้างผู้ใช้ใน Authentication > Users แล้ว)
--    แก้อีเมลให้ตรงกับที่สร้างไว้ แล้วรันเฉพาะบรรทัดนี้:
--
--    insert into public.admins (user_id)
--    select id from auth.users where email = 'อีเมลของคุณ@example.com'
--    on conflict do nothing;
-- ============================================================================
