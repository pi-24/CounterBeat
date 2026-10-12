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

-- Issues a token unless the player already started p_max runs in the last
-- ten minutes; returns the token id, or null when over the limit.  The
-- per-player advisory lock makes the count and the insert one step, so
-- requests fired at the same moment cannot all slip under the limit.
create or replace function public.issue_run_token(p_user uuid, p_chart text, p_max int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    recent int;
    issued uuid;
begin
    perform pg_advisory_xact_lock(hashtextextended('run_tokens:' || p_user::text, 0));
    select count(*) into recent
      from public.run_tokens
     where user_id = p_user
       and issued_at >= now() - interval '10 minutes';
    if recent >= p_max then
        return null;
    end if;
    insert into public.run_tokens (user_id, chart_id)
    values (p_user, p_chart)
    returning id into issued;
    return issued;
end;
$$;

-- It takes any user id, so only the edge function (service role) may call it.
revoke execute on function public.issue_run_token(uuid, text, int) from public, anon, authenticated;
grant execute on function public.issue_run_token(uuid, text, int) to service_role;

-- ------------------------------------------------------- log fingerprints
-- What a run did (which bot each shot went to, where, and when), hashed by
-- submit-run.  Unique, so a replay log copied from the rankings cannot be
-- stored a second time under another name.  Short runs are not fingerprinted.
alter table public.runs add column if not exists log_fingerprint text;
create unique index if not exists runs_log_fingerprint
    on public.runs (log_fingerprint) where log_fingerprint is not null;

-- ------------------------------------------------------- best-run replays
-- Only a player's best run on each chart keeps its replay log.  submit-run
-- stores every run with its log and then calls this, which clears the log
-- from the player's other runs on that chart (on a tie the earlier run stays
-- the best, matching the rankings).  The fingerprint stays on every run, so
-- a copied log is still refused after its replay is gone.
create or replace function public.keep_best_replay(p_user uuid, p_chart text)
returns void
language sql
security definer
set search_path = public
as $$
    update public.runs
       set log = null
     where user_id = p_user
       and chart_id = p_chart
       and log is not null
       and id <> (
           select b.id from public.runs b
            where b.user_id = p_user and b.chart_id = p_chart
            order by b.score desc, b.played_at asc
            limit 1
       );
$$;

-- It takes any user id, so only the edge function (service role) may call it.
revoke execute on function public.keep_best_replay(uuid, text) from public, anon, authenticated;
grant execute on function public.keep_best_replay(uuid, text) to service_role;

-- One-off: apply the same rule to the runs already stored.  This permanently
-- deletes the replay logs of runs that are not their player's best on that
-- chart (the runs and scores themselves are kept).
update public.runs r
   set log = null
 where r.log is not null
   and exists (
       select 1 from public.runs b
        where b.user_id = r.user_id
          and b.chart_id = r.chart_id
          and (b.score > r.score or (b.score = r.score and b.played_at < r.played_at))
   );

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
