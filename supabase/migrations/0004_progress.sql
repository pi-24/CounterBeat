-- Stars, equipped cosmetics and the calibrated flag, synced from the client.
-- Purely cosmetic progression: NOT server-verified and never read by
-- submit-run or any ranking logic (see README "Stars and tampering").
alter table public.profiles add column if not exists progress jsonb not null default '{}'::jsonb;
