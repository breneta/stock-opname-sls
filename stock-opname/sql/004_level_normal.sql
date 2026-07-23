-- Bring Rimpilan's Level pattern to Normal SO too — a shelf/rak in this
-- warehouse can be several levels tall, and the physical spot being counted
-- can differ between counts, so (like Rimpilan) it's picked fresh by the
-- petugas at input time, never defaulted or pulled from master data.
--
-- Nullable on purpose: existing so_entries rows saved before this change
-- have no level and shouldn't be forced to backfill a guess. New rows from
-- the UI always send a value (validated client-side, 1-7).
--
-- Safe to re-run.

alter table so_entries add column if not exists level int check (level between 1 and 7);

create index if not exists idx_so_entries_level on so_entries(session_id, material_code, nomor_rak, level);
