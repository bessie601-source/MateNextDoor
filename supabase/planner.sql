-- Storage for the appointment planner (/appointmentplanner/).
-- Run once in Supabase → SQL Editor. Safe to run again.

-- Who may use the planner. Sign-in accounts themselves are created under Authentication → Users.
create table if not exists public.planner_members (
  email text primary key check (email = lower(email))
);

-- One row per planner document: clients, appointments, jobs, sms, hours and config.
create table if not exists public.planner_docs (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

alter table public.planner_members enable row level security;
alter table public.planner_docs enable row level security;

create or replace function public.is_planner_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.planner_members
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

drop policy if exists "Members can see their own entry" on public.planner_members;
create policy "Members can see their own entry" on public.planner_members
  for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "Members manage planner data" on public.planner_docs;
create policy "Members manage planner data" on public.planner_docs
  for all to authenticated
  using (public.is_planner_member())
  with check (public.is_planner_member());

-- Let the API reach the tables; the policies above still decide what each person sees.
-- Needed because newer Supabase projects don't open new tables to the API automatically.
grant usage on schema public to authenticated, service_role;
grant select on public.planner_members to authenticated;
grant select, insert, update, delete on public.planner_docs to authenticated;
grant execute on function public.is_planner_member() to authenticated;
grant select on public.planner_docs, public.planner_members to service_role; -- the morning email
revoke all on public.planner_members, public.planner_docs from anon;

-- Give Will access. Add a line per extra person.
insert into public.planner_members (email) values ('will@matenextdoor.com')
  on conflict do nothing;
