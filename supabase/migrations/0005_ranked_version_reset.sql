-- Ranked gate, chart-version filter and the one-time launch reset (AC12, AC14).
--
-- * runs.chart_version: the chart version a run was verified against
--   (0 for generated charts: Easy, Normal and Daily). submit-run fills it.
-- * chart_versions: the ACTIVE version per chart, written only by the
--   submit-run edge function (service role) from its own bundled charts.
--   leaderboard(chart_filter) shows only runs on the active version, so
--   swapping a track's audio or chart (which bumps its version) retires its
--   old scores. The client cannot choose the version (no argument).
-- * Easy and Normal are refused by submit-run; this also makes the database
--   refuse them for track runs.
-- * The leaderboards are reset exactly once, guarded by a flag row, so
--   re-running this migration never wipes scores again.
--
-- Run it with `supabase db push`; nothing here is run by the tests.

alter table public.runs add column if not exists chart_version int not null default 0;

alter table public.runs drop constraint if exists runs_ranked_difficulty;
alter table public.runs add constraint runs_ranked_difficulty
    check (kind <> 'track' or difficulty in ('hard', 'expert')) not valid;

create table if not exists public.chart_versions (
    chart_id text primary key,
    version int not null default 0,
    updated_at timestamptz not null default now()
);
alter table public.chart_versions enable row level security;
create policy chart_versions_read on public.chart_versions for select using (true);

-- Monotonic: a version can only go up (called by submit-run, service role).
create or replace function public.set_chart_version(p_chart text, p_version int)
returns void
language sql
security definer
set search_path = public
as $fn$
    insert into public.chart_versions (chart_id, version) values (p_chart, p_version)
    on conflict (chart_id) do update
        set version = greatest(public.chart_versions.version, excluded.version), updated_at = now();
$fn$;
revoke all on function public.set_chart_version(text, int) from public, anon, authenticated;
grant execute on function public.set_chart_version(text, int) to service_role;

drop function if exists public.leaderboard(text);
drop function if exists public.leaderboard(text, jsonb);

create or replace function public.leaderboard(chart_filter text default null)
returns table (
    run_id uuid, user_id uuid, display_name text, main_game text,
    chart_id text, chart_version int, level_id int, level_name text, score int, accuracy real,
    best_combo int, counter_strafes int, headshots int, played_at timestamptz,
    runs bigint, has_replay boolean
)
language sql
stable
as $$
    select distinct on (r.user_id)
        r.id, r.user_id, p.display_name, p.main_game,
        r.chart_id, r.chart_version, r.level_id, r.level_name, r.score, r.accuracy,
        r.best_combo, r.counter_strafes, r.headshots, r.played_at,
        count(*) over (partition by r.user_id) as runs,
        (r.log is not null) as has_replay
    from public.runs r
    join public.profiles p on p.id = r.user_id
    left join public.chart_versions cv on cv.chart_id = r.chart_id
    where r.verified
      and r.kind in ('track', 'daily')
      and (r.kind = 'daily' or r.difficulty in ('hard', 'expert'))
      and (chart_filter is null or r.chart_id = chart_filter)
      and r.chart_version = coalesce(cv.version, 0)
    order by r.user_id, r.score desc, r.played_at asc;
$$;

grant execute on function public.leaderboard(text) to anon, authenticated;

-- ---------------------------------------------------------- one-time reset
create table if not exists public.migration_flags (
    name text primary key,
    applied_at timestamptz not null default now()
);
alter table public.migration_flags enable row level security;

do $$
begin
    if not exists (select 1 from public.migration_flags where name = 'leaderboard_reset_launch') then
        delete from public.runs where kind in ('track', 'daily');
        delete from public.run_tokens;
        insert into public.migration_flags (name) values ('leaderboard_reset_launch');
    end if;
end
$$;
