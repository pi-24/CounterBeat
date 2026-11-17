-- SteamID64 linked to a profile by a verified Steam session ticket (AC32).
-- Written only by the submit-run edge function (service role).
alter table public.profiles add column if not exists steam_id text unique;
