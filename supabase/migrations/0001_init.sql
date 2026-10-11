-- CounterBeat schema.  Apply with `supabase db push` or paste into the SQL
-- editor of a fresh project.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
    id            uuid primary key references auth.users (id) on delete cascade,
    display_name  text not null,
    main_game     text,
    settings      jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now(),
    constraint display_name_length check (char_length(display_name) between 3 and 20),
    constraint display_name_chars  check (display_name ~ '^[A-Za-z0-9 _.-]+$')
);
create unique index profiles_display_name_ci on public.profiles (lower(display_name));

-- A profile is created from the sign-up metadata the moment the auth user
-- exists, so the client never has to make a second call.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    wanted text := coalesce(new.raw_user_meta_data ->> 'display_name', 'Player');
    candidate text := wanted;
    n int := 1;
begin
    while exists (select 1 from public.profiles where lower(display_name) = lower(candidate)) loop
        n := n + 1;
        candidate := left(wanted, 17) || '_' || n;
    end loop;
    insert into public.profiles (id, display_name, main_game)
    values (new.id, candidate, new.raw_user_meta_data ->> 'main_game');
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- -------------------------------------------------------------------- runs
create table public.runs (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references public.profiles (id) on delete cascade,
    level_id         int  not null,
    level_name       text not null,
    score            int  not null,
    accuracy         real not null,
    best_combo       int  not null,
    counter_strafes  int  not null,
    headshots        int  not null default 0,
    perfect          int  not null default 0,
    good             int  not null default 0,
    loose            int  not null default 0,
    missed           int  not null default 0,
    notes            int  not null default 0,
    completed        boolean not null,
    passed           boolean not null,
    rank             text,
    client_score     int,
    verified         boolean not null default false,
    played_at        timestamptz not null default now()
);
create index runs_user_played on public.runs (user_id, played_at desc);
create index runs_level_score on public.runs (level_id, score desc);

-- --------------------------------------------------------------- policies
alter table public.profiles enable row level security;
alter table public.runs     enable row level security;

-- Everyone can read profiles (they are what the rankings table shows);
-- only the owner can change their own.
create policy "profiles are public"      on public.profiles for select using (true);
create policy "owner updates profile"    on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Runs are public to read.  There is deliberately NO insert policy: the
-- only way a run gets in is through the submit-run edge function, which
-- replays the input log and writes with the service role.
create policy "runs are public"          on public.runs for select using (true);
create policy "owner deletes own runs"   on public.runs for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------ leaderboard
-- Best verified run per player, optionally for one level.
create or replace function public.leaderboard(level_filter int default null)
returns table (
    user_id uuid, display_name text, main_game text,
    level_id int, level_name text, score int, accuracy real,
    best_combo int, counter_strafes int, headshots int, played_at timestamptz, runs bigint
)
language sql
stable
as $$
    select distinct on (r.user_id)
        r.user_id, p.display_name, p.main_game,
        r.level_id, r.level_name, r.score, r.accuracy,
        r.best_combo, r.counter_strafes, r.headshots, r.played_at,
        count(*) over (partition by r.user_id) as runs
    from public.runs r
    join public.profiles p on p.id = r.user_id
    where r.verified
      and r.level_id > 0
      and (level_filter is null or r.level_id = level_filter)
    order by r.user_id, r.score desc, r.played_at asc;
$$;

grant execute on function public.leaderboard(int) to anon, authenticated;
