-- =========================================================
-- WAREHOUSE SUITE — SHARED SUPABASE SCHEMA
-- Safe to paste and Run this whole file every time it changes —
-- every statement below is written to be re-runnable, whether
-- your project is brand new or already has these tables.
-- Both apps (Stock Opname & Manajemen Material Rimpilan) point
-- at the same Supabase project but use separate tables.
-- =========================================================

-- ---------------------------------------------------------
-- APP 1: STOCK OPNAME
-- ---------------------------------------------------------

create table if not exists so_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,                      -- e.g. "Stock Opname RDC Jakarta - Juli 2026"
  status text not null default 'active',   -- active | closed
  created_at timestamptz not null default now()
);
-- Column additions run right after the table so anything below
-- (indexes, constraints) can safely assume the column exists,
-- whether this is a fresh install or an upgrade of an old project.
alter table so_sessions add column if not exists plant text; -- RDC this session belongs to (e.g. "RDC Jakarta")

create table if not exists so_sap_data (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references so_sessions(id) on delete cascade,
  material text not null,
  batch text not null,
  base_uom text,
  plant text,
  storage_location text,
  material_description text,
  material_group text,
  qty numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_so_sap_data_session on so_sap_data(session_id);
create index if not exists idx_so_sap_data_material on so_sap_data(session_id, material);

create table if not exists so_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references so_sessions(id) on delete cascade,
  petugas_nama text not null,
  material_code text not null,
  material_description text,
  batch text,
  plant text,
  storage_location text,
  nomor_rak text not null,
  qty_fisik numeric not null,
  kondisi_barang text not null default 'Normal', -- Normal | Pecah | Gumpil | Pecah & Gumpil
  catatan text,
  status_sap text not null default 'ditemukan',  -- ditemukan | tidak_ada_di_sap (only meaningful when source = 'sap')
  created_at timestamptz not null default now()
);
alter table so_entries add column if not exists source text not null default 'sap'; -- sap | rimpilan — which master data this scan matched
create index if not exists idx_so_entries_session on so_entries(session_id);
create index if not exists idx_so_entries_material on so_entries(session_id, material_code);

-- ---------------------------------------------------------
-- APP 2: MANAJEMEN MATERIAL RIMPILAN
-- ---------------------------------------------------------

create table if not exists mr_materials (
  id uuid primary key default gen_random_uuid(),
  kode_material text not null,
  nama_material text not null,
  satuan text not null,
  keterangan text,
  stok numeric not null default 0,
  created_at timestamptz not null default now()
);
alter table mr_materials add column if not exists plant text not null default ''; -- RDC lokasi material ini (mis. "RDC Jakarta")
alter table mr_materials add column if not exists nomor_rak text;
alter table mr_materials add column if not exists batch text; -- opsional, informasi referensi (bukan bagian kunci pencarian)

-- widen the old single-column unique constraint (kode_material) to
-- the new composite one (kode_material, plant) — safe to re-run.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'mr_materials_kode_material_key') then
    alter table mr_materials drop constraint mr_materials_kode_material_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mr_materials_kode_material_plant_key') then
    alter table mr_materials add constraint mr_materials_kode_material_plant_key unique (kode_material, plant);
  end if;
end $$;

create index if not exists idx_mr_materials_lookup on mr_materials(kode_material, plant);

create table if not exists mr_transaksi (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references mr_materials(id) on delete cascade,
  tipe text not null,              -- masuk | keluar
  tanggal date not null,
  qty numeric not null,
  keterangan text,
  created_at timestamptz not null default now()
);
create index if not exists idx_mr_transaksi_material on mr_transaksi(material_id);

-- Stock is kept in sync automatically via trigger so it can never
-- drift from the transaction history, regardless of which client
-- inserts/deletes a transaksi row.
create or replace function mr_apply_transaksi() returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    if new.tipe = 'masuk' then
      update mr_materials set stok = stok + new.qty where id = new.material_id;
    else
      update mr_materials set stok = stok - new.qty where id = new.material_id;
    end if;
    return new;
  elsif TG_OP = 'DELETE' then
    if old.tipe = 'masuk' then
      update mr_materials set stok = stok - old.qty where id = old.material_id;
    else
      update mr_materials set stok = stok + old.qty where id = old.material_id;
    end if;
    return old;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_mr_apply_transaksi on mr_transaksi;
create trigger trg_mr_apply_transaksi
  after insert or delete on mr_transaksi
  for each row execute function mr_apply_transaksi();

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
-- Internal tool: open read/write via anon key by default so the
-- app works out of the box. Tighten these policies (e.g. require
-- auth, or restrict by role) before exposing this outside your
-- internal network.
-- ---------------------------------------------------------
alter table so_sessions enable row level security;
alter table so_sap_data enable row level security;
alter table so_entries enable row level security;
alter table mr_materials enable row level security;
alter table mr_transaksi enable row level security;

drop policy if exists "allow all so_sessions" on so_sessions;
drop policy if exists "allow all so_sap_data" on so_sap_data;
drop policy if exists "allow all so_entries" on so_entries;
drop policy if exists "allow all mr_materials" on mr_materials;
drop policy if exists "allow all mr_transaksi" on mr_transaksi;

create policy "allow all so_sessions" on so_sessions for all using (true) with check (true);
create policy "allow all so_sap_data" on so_sap_data for all using (true) with check (true);
create policy "allow all so_entries" on so_entries for all using (true) with check (true);
create policy "allow all mr_materials" on mr_materials for all using (true) with check (true);
create policy "allow all mr_transaksi" on mr_transaksi for all using (true) with check (true);

-- ---------------------------------------------------------
-- Done. Now run this in a new query to force Supabase to pick up
-- the changes immediately:
--   NOTIFY pgrst, 'reload schema';
-- ---------------------------------------------------------
