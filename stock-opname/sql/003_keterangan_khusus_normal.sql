-- Bring Rimpilan's "Keterangan Khusus" pattern to Normal SO — replaces the
-- old single Kondisi Barang dropdown + free-text Catatan with the same
-- multi-add, qty-per-condition pattern already used by rimpilan_entries
-- (Pecah / Pallet rusak / Stock tidak terikat / Kardus rusak / Lainnya,
-- each with its own qty, metadata-only — excluded from the Selisih sum,
-- see lib/reconciliation.js).
--
-- Old columns (kondisi_barang, catatan) are kept, NOT dropped — existing
-- so_entries rows already have real data there and the app still reads
-- them as a fallback in the Rekonsiliasi detail view. The UI simply stops
-- writing new rows through them going forward.
--
-- Safe to re-run.

alter table so_entries add column if not exists keterangan_khusus text check (
  keterangan_khusus in ('Pecah', 'Pallet rusak', 'Stock tidak terikat', 'Kardus rusak', 'Lainnya')
);
alter table so_entries add column if not exists keterangan_catatan text;

create index if not exists idx_so_entries_keterangan on so_entries(session_id, keterangan_khusus) where keterangan_khusus is not null;
