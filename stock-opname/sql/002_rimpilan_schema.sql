-- Rimpilan SO — schema addition
-- Adds a Rimpilan counting workflow that runs inside the same so_sessions
-- row as Normal SO (2 tabs, 1 session), with its own master data and its
-- own append-only entries table, mirroring the so_sap_data / so_entries
-- pattern already used by Normal SO.
--
-- Run this in the Supabase SQL editor (or via `supabase db push` if you
-- wire up migrations later). Safe to re-run — everything is IF NOT EXISTS.
--
-- PREREQUISITE — Recount for Normal SO (Part 0):
-- This project did not have a recount feature yet (no active_recount_round,
-- no so_recount_rounds, so_entries had no recount_round column). Rimpilan's
-- recount is specced to share round state with Normal SO, so that has to
-- exist first. Part 0 below adds it. If you already have this (e.g. you
-- copied it in from elsewhere), these statements are all IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS so re-running is harmless.

-- 0a) so_entries needs a recount_round column. A material can be counted
--     in round 0 (first pass), then flagged for recount and counted again
--     in round 1, 2, ... Only the entries from the HIGHEST round for a
--     given material count toward the total — older rounds stay in the
--     table (never deleted, audit trail) but are excluded from the sum.
alter table so_entries add column if not exists recount_round int not null default 0;
create index if not exists idx_so_entries_round on so_entries(session_id, recount_round);

-- 0b) so_sessions needs to carry the "is a recount currently active, and
--     for which materials" state, so the Input page can restrict petugas
--     to only the flagged materials while a round is open.
alter table so_sessions add column if not exists active_recount_round int not null default 0;
alter table so_sessions add column if not exists recount_material_codes jsonb not null default '[]'::jsonb;

-- 0c) so_recount_rounds — history log of every recount round started,
--     independent of so_sessions' "current" state above (which only ever
--     holds the LATEST round). Useful for an audit trail of "when was
--     round 2 started, and for which materials."
create table if not exists so_recount_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references so_sessions(id) on delete cascade,
  round_number int not null,
  material_codes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_so_recount_rounds_session on so_recount_rounds(session_id);


-- 1) Rimpilan master data — same shape as so_sap_data, plus the rak/level
--    assignment that comes from the upload file itself (Normal SO doesn't
--    have this: nomor_rak there is only known once a petugas physically
--    finds the item. Rimpilan is different — the rak/level is decided by
--    the layout beforehand, that's the whole point of the accordion UI).
create table if not exists rimpilan_sap_data (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references so_sessions(id) on delete cascade,
  material_code text not null,
  material_description text,
  batch text,
  plant text,
  storage_location text,
  base_uom text,
  qty numeric not null default 0,        -- qty dari master (NOT shown to petugas during input — fresh count)
  nomor_rak text not null,
  level int not null default 1 check (level between 1 and 7),
  created_at timestamptz not null default now()
);

create index if not exists idx_rimpilan_sap_data_session on rimpilan_sap_data(session_id);
create index if not exists idx_rimpilan_sap_data_material on rimpilan_sap_data(session_id, material_code);
-- This is the index the accordion UI leans on hardest: "give me every
-- material assigned to rak X for session Y", grouped for the UI in JS.
create index if not exists idx_rimpilan_sap_data_rak on rimpilan_sap_data(session_id, nomor_rak);

-- 2) Rimpilan entries — append-only, same audit-trail rule as so_entries:
--    rows are never updated, only ever inserted. One save action from the
--    accordion form can produce MULTIPLE rows for the same material+rak+
--    level: one "normal qty" row (keterangan_khusus = null) plus zero or
--    more "keterangan khusus" rows (one per condition the petugas flags).
--    Keterangan khusus rows are metadata/audit only — see reconciliation.js,
--    they are excluded from the qty sum used to compute Selisih.
create table if not exists rimpilan_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references so_sessions(id) on delete cascade,
  petugas_nama text not null,
  material_code text not null,
  material_description text,
  batch text,
  plant text,
  storage_location text,
  nomor_rak text not null,
  level int not null check (level between 1 and 7),
  qty_fisik numeric not null default 0,
  keterangan_khusus text check (
    keterangan_khusus in ('Pecah', 'Pallet rusak', 'Stock tidak terikat', 'Kardus rusak', 'Lainnya')
  ),
  keterangan_catatan text,               -- free-text detail, esp. useful/expected when keterangan_khusus = 'Lainnya'
  recount_round int not null default 0,  -- shares the SAME round counter as so_entries.recount_round (one session, one round state)
  created_at timestamptz not null default now()
);

create index if not exists idx_rimpilan_entries_session on rimpilan_entries(session_id);
create index if not exists idx_rimpilan_entries_material on rimpilan_entries(session_id, material_code, batch, plant, storage_location);
create index if not exists idx_rimpilan_entries_round on rimpilan_entries(session_id, recount_round);
create index if not exists idx_rimpilan_entries_rak on rimpilan_entries(session_id, nomor_rak);

-- 3) Warehouse racks master — simple gudang -> rak mapping, scoped to a
--    session (uploaded per session, same as everything else here, so a
--    stale rack list from a previous period never leaks into a new one).
create table if not exists warehouse_racks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references so_sessions(id) on delete cascade,
  warehouse_code text not null,
  rack_code text not null,
  created_at timestamptz not null default now(),
  unique (session_id, warehouse_code, rack_code)
);

create index if not exists idx_warehouse_racks_session on warehouse_racks(session_id);
create index if not exists idx_warehouse_racks_warehouse on warehouse_racks(session_id, warehouse_code);

-- NOTE on RLS: this project's existing tables (so_sap_data, so_entries,
-- so_sessions) are queried directly from the browser via the anon key, so
-- presumably RLS is either disabled or has a permissive policy already in
-- place. If RLS is ON, mirror whatever policy so_entries/so_sap_data use
-- onto these 3 new tables — otherwise every insert/select above will
-- silently return empty results instead of an obvious error.
