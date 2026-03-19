create table if not exists public.planner_days (
  date_key text primary key,
  notes text not null default '',
  entries jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.planner_settings (
  id text primary key,
  asignado_options jsonb not null default '[]'::jsonb,
  company_name text not null default '',
  company_subtitle text not null default '',
  company_logo_data_url text not null default '',
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.planner_settings
  add column if not exists company_name text not null default '';

alter table public.planner_settings
  add column if not exists company_subtitle text not null default '';

alter table public.planner_settings
  add column if not exists company_logo_data_url text not null default '';

create table if not exists public.planner_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid references auth.users (id) on delete set null
);

create or replace function public.planner_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists planner_settings_touch_updated_at on public.planner_settings;
create trigger planner_settings_touch_updated_at
before update on public.planner_settings
for each row
execute function public.planner_touch_updated_at();

drop trigger if exists planner_users_touch_updated_at on public.planner_users;
create trigger planner_users_touch_updated_at
before update on public.planner_users
for each row
execute function public.planner_touch_updated_at();

insert into public.planner_settings (id, asignado_options)
values ('shared', '["Bea","Cris","Gloria","Alfredo","Aída"]'::jsonb)
on conflict (id) do nothing;

create or replace function public.is_active_planner_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.planner_users
    where id = auth.uid()
      and is_active = true
  );
$$;

create or replace function public.current_planner_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.planner_users
  where id = auth.uid()
    and is_active = true
  limit 1;
$$;

create or replace function public.planner_has_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.planner_users
  );
$$;

create or replace function public.planner_bootstrap_admin()
returns public.planner_users
language plpgsql
security definer
set search_path = public
as $$
declare
  next_user public.planner_users;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para crear el administrador inicial.';
  end if;

  if exists (select 1 from public.planner_users) then
    raise exception 'La app ya tiene usuarios.';
  end if;

  insert into public.planner_users (
    id,
    email,
    role,
    is_active,
    created_by
  )
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', ''),
    'admin',
    true,
    auth.uid()
  )
  on conflict (id) do update
  set
    email = excluded.email,
    role = 'admin',
    is_active = true,
    created_by = excluded.created_by,
    updated_at = timezone('utc', now())
  returning * into next_user;

  return next_user;
end;
$$;

alter table public.planner_days enable row level security;
alter table public.planner_settings enable row level security;
alter table public.planner_users enable row level security;

revoke all on table public.planner_days from anon, authenticated;
revoke all on table public.planner_settings from anon, authenticated;
revoke all on table public.planner_users from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.planner_days to anon;
grant select on public.planner_settings to anon;
grant select, insert, update, delete on public.planner_days to authenticated;
grant select, update on public.planner_settings to authenticated;
grant select on public.planner_users to authenticated;
grant execute on function public.is_active_planner_user() to authenticated;
grant execute on function public.current_planner_role() to authenticated;
grant execute on function public.planner_has_users() to anon, authenticated;
grant execute on function public.planner_bootstrap_admin() to authenticated;

drop policy if exists planner_days_select_public on public.planner_days;
create policy planner_days_select_public
on public.planner_days
for select
to anon
using (true);

drop policy if exists planner_days_select_active_users on public.planner_days;
create policy planner_days_select_active_users
on public.planner_days
for select
to authenticated
using (public.is_active_planner_user());

drop policy if exists planner_days_write_admin_or_editor on public.planner_days;
create policy planner_days_write_admin_or_editor
on public.planner_days
for all
to authenticated
using (public.current_planner_role() in ('admin', 'editor'))
with check (public.current_planner_role() in ('admin', 'editor'));

drop policy if exists planner_settings_select_public on public.planner_settings;
create policy planner_settings_select_public
on public.planner_settings
for select
to anon
using (true);

drop policy if exists planner_settings_select_active_users on public.planner_settings;
create policy planner_settings_select_active_users
on public.planner_settings
for select
to authenticated
using (public.is_active_planner_user());

drop policy if exists planner_settings_update_admin on public.planner_settings;
create policy planner_settings_update_admin
on public.planner_settings
for update
to authenticated
using (public.current_planner_role() = 'admin')
with check (public.current_planner_role() = 'admin');

drop policy if exists planner_users_select_self on public.planner_users;
create policy planner_users_select_self
on public.planner_users
for select
to authenticated
using (id = auth.uid());

drop policy if exists planner_users_select_admin on public.planner_users;
create policy planner_users_select_admin
on public.planner_users
for select
to authenticated
using (public.current_planner_role() = 'admin');
