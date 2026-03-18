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

insert into public.planner_settings (id, asignado_options)
values ('shared', '["Bea","Cris","Gloria","Alfredo","Aída"]'::jsonb)
on conflict (id) do nothing;

alter table public.planner_days disable row level security;
alter table public.planner_settings disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.planner_days to anon, authenticated;
grant select, insert, update, delete on public.planner_settings to anon, authenticated;
