-- Phase 2: tracks × difficulties, daily challenge, custom songs, replays, stats.
--
-- Runs are now identified by a chart id ("t:neon:hard", "daily:2026-10-11",
-- "custom:<hash>:<difficulty>") rather than a level number; level_id stays as
-- the chart's tier (0 tutorial, 1-4 easy..expert, 5 daily, 6 custom) so old
-- rows keep working.  Replay logs are stored on the row so anyone can watch a
-- leaderboard run; stats hold the timing histogram for the profile page.

alter table public.runs
    add column if not exists chart_id    text,
    add column if not exists kind        text not null default 'track',
    add column if not exists track_id    text,
    add column if not exists track_name  text,
    add column if not exists difficulty  text,
    add column if not exists stats       jsonb,
    add column if not exists log         jsonb;

-- Lets lists of runs say whether a replay exists without reading the log.
alter table public.runs
    add column if not exists has_log boolean generated always as (log is not null) stored;

-- Rows from before this migration were the old levels 1-3.
update public.runs
   set chart_id = case level_id
                      when 1 then 't:range:easy'
                      when 2 then 't:neon:normal'
                      when 3 then 't:vault:hard'
                      else 'legacy:' || level_id end,
       track_id = case level_id when 1 then 'range' when 2 then 'neon' when 3 then 'vault' end,
       track_name = level_name,
       difficulty = case level_id when 1 then 'easy' when 2 then 'normal' when 3 then 'hard' end
 where chart_id is null;

alter table public.runs alter column chart_id set not null;

create index if not exists runs_chart_score on public.runs (chart_id, score desc) where verified;
create index if not exists runs_kind on public.runs (kind);

-- Custom-song runs can only ever be personal bests: never verified, never
-- ranked.  Make the database say so, not just the client.
alter table public.runs drop constraint if exists runs_custom_unverified;
alter table public.runs add constraint runs_custom_unverified
    check (kind <> 'custom' or verified = false);

-- ------------------------------------------------------------ leaderboard
-- Best verified run per player, optionally for one chart.  Replaces the
-- level_id version.
drop function if exists public.leaderboard(int);

create or replace function public.leaderboard(chart_filter text default null)
returns table (
    run_id uuid, user_id uuid, display_name text, main_game text,
    chart_id text, level_id int, level_name text, score int, accuracy real,
    best_combo int, counter_strafes int, headshots int, played_at timestamptz,
    runs bigint, has_replay boolean
)
language sql
stable
as $$
    select distinct on (r.user_id)
        r.id, r.user_id, p.display_name, p.main_game,
        r.chart_id, r.level_id, r.level_name, r.score, r.accuracy,
        r.best_combo, r.counter_strafes, r.headshots, r.played_at,
        count(*) over (partition by r.user_id) as runs,
        (r.log is not null) as has_replay
    from public.runs r
    join public.profiles p on p.id = r.user_id
    where r.verified
      and r.kind in ('track', 'daily')
      and (chart_filter is null or r.chart_id = chart_filter)
    order by r.user_id, r.score desc, r.played_at asc;
$$;

grant execute on function public.leaderboard(text) to anon, authenticated;

-- ----------------------------------------------------------------- replay
-- One run's input log, by id.  Separate from the row reads so lists of runs
-- never carry the heavy column.
create or replace function public.run_replay(run uuid)
returns table (
    id uuid, user_id uuid, display_name text, chart_id text, level_name text,
    score int, accuracy real, played_at timestamptz, log jsonb
)
language sql
stable
as $$
    select r.id, r.user_id, p.display_name, r.chart_id, r.level_name,
           r.score, r.accuracy, r.played_at, r.log
    from public.runs r
    join public.profiles p on p.id = r.user_id
    where r.id = run;
$$;

grant execute on function public.run_replay(uuid) to anon, authenticated;
