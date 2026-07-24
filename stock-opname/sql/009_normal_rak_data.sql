-- Master Rak Normal SO — mapping Material + Batch -> Nomor Rak, uploaded
-- by Accounting, same idea as rimpilan_sap_data.nomor_rak but kept as its
-- own table/upload instead of merged into so_sap_data. Reasons:
--   1) so_sap_data comes from a separate "Upload Data SAP" step that may
--      get re-uploaded/refreshed independently — bolting rak onto it would
--      risk losing the rak mapping on a routine SAP data refresh.
--   2) Rak assignment for Normal SO and Rimpilan are explicitly SEPARATE
--      master lists per business rule (beda gudang/layout kadang), so this
--      must not share a table with rimpilan_sap_data either.
--
-- Full material detail (description/plant/storage/base_uom/qty) is NOT
-- duplicated here — the Input page joins this against so_sap_data by
-- material_code + batch at read time, so_sap_data stays the single source
-- of truth for those fields.
--
-- Safe to re-run.

create table if not exists normal_rak_data (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references so_sessions(id) on delete cascade,
  material_code text not null,
  batch text not null,
  nomor_rak text not null,
  created_at timestamptz not null default now(),
  unique (session_id, material_code, batch, nomor_rak)
);

create index if not exists idx_normal_rak_data_session on normal_rak_data(session_id);
create index if not exists idx_normal_rak_data_material on normal_rak_data(session_id, material_code, batch);
-- What the Input accordion leans on hardest: "every material assigned to
-- rak X for session Y" — same pattern as idx_rimpilan_sap_data_rak.
create index if not exists idx_normal_rak_data_rak on normal_rak_data(session_id, nomor_rak);

-- NOTE on RLS: mirror whatever policy so_entries/so_sap_data already use
-- onto this table if RLS is enabled — otherwise queries will silently
-- return empty instead of an obvious error.
