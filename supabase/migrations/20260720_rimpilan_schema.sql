-- Rimpilan SO workflow — schema addition
-- Adds 3 tables: rimpilan_sap_data, rimpilan_entries, warehouse_racks.
-- Mirrors the existing so_sap_data / so_entries pattern (append-only entries,
-- session-scoped master data) so the two workflows share the same
-- session lifecycle (so_sessions.active_recount_round / recount_material_codes)
-- without touching the existing normal-SO tables.

-- ============================================================
-- 1. warehouse_racks — simple gudang -> rak mapping, per session
-- ============================================================
create table if not exists warehouse_racks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references so_sessions(id) on delete cascade,
  warehouse_code text not null,
  rack_code text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists warehouse_racks_unique
  on warehouse_racks (session_id, warehouse_code, rack_code);

create index if not exists warehouse_racks_session_idx
  on warehouse_racks (session_id);

-- ============================================================
-- 2. rimpilan_sap_data — master data for the Rimpilan workflow.
--    Same template as so_sap_data (Material, Batch, Plant, Storage
--    Location, UoM, Material Group, Qty) plus Nomor Rak + Level, which
--    normal SO master data doesn't need.
-- ============================================================
create table if not exists rimpilan_sap_data (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references so_sessions(id) on delete cascade,
  material_code text not null,
  material_description text,
  batch text,
  plant text not null,
  storage_location text,
  base_uom text,
  material_group text,
  qty numeric not null default 0,        -- Qty SAP (sudah termasuk rimpilan, per aturan bisnis)
  nomor_rak text not null,
  level int not null default 1 check (level between 1 and 7),  -- default dari file upload, bisa dikoreksi petugas saat input
  created_at timestamptz not null default now()
);

create index if not exists rimpilan_sap_data_session_idx
  on rimpilan_sap_data (session_id);

create index if not exists rimpilan_sap_data_material_idx
  on rimpilan_sap_data (session_id, material_code);

create index if not exists rimpilan_sap_data_rak_idx
  on rimpilan_sap_data (session_id, nomor_rak);

-- ============================================================
-- 3. rimpilan_entries — append-only physical count entries, same
--    discipline as so_entries: rows are never updated, only inserted.
--    A material+rak+level can have MULTIPLE rows: one "normal" qty row
--    (keterangan_khusus = null) plus zero or more keterangan_khusus rows
--    (Pecah, Pallet rusak, dst) — all of them are summed into total
--    qty_fisik at reconciliation time; keterangan_khusus itself is
--    metadata only and does not change how qty is calculated.
-- ============================================================
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
    keterangan_khusus is null or keterangan_khusus in (
      'Pecah', 'Pallet rusak', 'Stock tidak terikat', 'Kardus rusak', 'Lainnya'
    )
  ),
  keterangan_catatan text,   -- free text, required when keterangan_khusus = 'Lainnya'
  recount_round int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists rimpilan_entries_session_idx
  on rimpilan_entries (session_id);

create index if not exists rimpilan_entries_material_idx
  on rimpilan_entries (session_id, material_code, batch, plant, storage_location);

create index if not exists rimpilan_entries_rak_idx
  on rimpilan_entries (session_id, nomor_rak, level);

create index if not exists rimpilan_entries_recount_idx
  on rimpilan_entries (session_id, recount_round);

-- ============================================================
-- RLS — match whatever policy style so_entries/so_sap_data already use.
-- Placeholder permissive policies so the app keeps working out of the box;
-- tighten these to match your existing so_* policies before going to prod.
-- ============================================================
alter table warehouse_racks enable row level security;
alter table rimpilan_sap_data enable row level security;
alter table rimpilan_entries enable row level security;

create policy "warehouse_racks_all" on warehouse_racks for all using (true) with check (true);
create policy "rimpilan_sap_data_all" on rimpilan_sap_data for all using (true) with check (true);
create policy "rimpilan_entries_all" on rimpilan_entries for all using (true) with check (true);
