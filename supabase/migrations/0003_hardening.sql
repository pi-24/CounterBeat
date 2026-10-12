-- Phase 3: harder to cheat, progress over every run, safer sign-up.
--
-- Apply after 0001 and 0002 (supabase db push, or paste into the SQL editor),
-- then redeploy the edge function:  npm run sync-rules && supabase functions deploy submit-run

-- ------------------------------------------------------------- run tokens
-- One row per ranked run started.  submit-run issues it when the run starts
-- and spends it when the run is submitted, so a submission must come from a
-- run this account actually started, at least as long ago as it lasted.
-- Only the edge function (service role) touches this table: RLS is on and
-- there are deliberately no policies.
create table if not exists public.run_tokens (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.profiles (id) on delete cascade,
    chart_id   text not null,
    issued_at  timestamptz not null default now(),
    used_at    timestamptz
);
create index if not exists run_tokens_user_issued on public.run_tokens (user_id, issued_at desc);
alter table public.run_tokens enable row level security;

-- ------------------------------------------------------- log fingerprints
-- What a run did (which bot each shot went to, where, and when), hashed by
-- submit-run.  Unique, so a replay log copied from the rankings cannot be
-- stored a second time under another name.  Short runs are not fingerprinted.
alter table public.runs add column if not exists log_fingerprint text;
create unique index if not exists runs_log_fingerprint
    on public.runs (log_fingerprint) where log_fingerprint is not null;

-- ------------------------------------------------------------- progress
-- Best score, accuracy and pass state per chart for one player, over all of
-- their runs (the client only lists the most recent 200).  Unverified runs
-- count only on custom songs, which can never be verified.
create or replace function public.player_progress(player uuid)
returns table (
    chart_id text, kind text, track_id text, track_name text,
    best_score int, best_accuracy real, max_accuracy real,
    passed boolean, runs bigint, counter_strafes bigint
)
language sql
stable
as $$
    select distinct on (r.chart_id)
        r.chart_id, r.kind, r.track_id, r.track_name,
        r.score as best_score,
        r.accuracy as best_accuracy,
        max(r.accuracy) over (partition by r.chart_id) as max_accuracy,
        bool_or(r.passed) over (partition by r.chart_id) as passed,
        count(*) over (partition by r.chart_id) as runs,
        sum(r.counter_strafes) over (partition by r.chart_id) as counter_strafes
    from public.runs r
    where r.user_id = player
      and (r.verified or r.kind = 'custom')
    order by r.chart_id, r.score desc, r.played_at asc;
$$;

grant execute on function public.player_progress(uuid) to anon, authenticated;

create index if not exists runs_user_chart on public.runs (user_id, chart_id);

-- ------------------------------------------------------------- sign-up
-- The display name comes from sign-up metadata, which any client can set.
-- Clean it to the profile rules (3-20 characters of A-Z a-z 0-9 space _ . -)
-- instead of letting a bad name make the whole sign-up fail, and keep the
-- "_2", "_3" suffix for a taken name inside the 20-character limit.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    wanted text := coalesce(new.raw_user_meta_data ->> 'display_name', '');
    base text;
    candidate text;
    n int := 1;
begin
    base := btrim(left(btrim(regexp_replace(wanted, '[^A-Za-z0-9 _.-]', '', 'g')), 20));
    if char_length(base) < 3 then
        base := 'Player';
    end if;
    candidate := base;
    while exists (select 1 from public.profiles where lower(display_name) = lower(candidate)) loop
        n := n + 1;
        candidate := left(base, 20 - char_length(n::text) - 1) || '_' || n;
    end loop;
    insert into public.profiles (id, display_name, main_game)
    values (new.id, candidate, left(new.raw_user_meta_data ->> 'main_game', 40));
    return new;
end;
$$;
