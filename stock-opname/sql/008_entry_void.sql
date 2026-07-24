-- "Void & Re-input" correction workflow for Admin.
--
-- Entries are append-only by design — rekonsiliasi selalu dihitung ulang
-- dari raw rows, jadi kita tidak pernah menimpa/menghapus data mentah.
-- Kalau petugas salah input material/batch/qty, cara resminya adalah:
--   1. Admin "membatalkan" (void) entry yang salah, dengan alasan wajib.
--   2. Entry yang di-void otomatis dikeluarkan dari semua perhitungan
--      (rekonsiliasi, dashboard, export, rak selisih, duplicate-check).
--   3. Entry lama tetap ada di database, utuh, untuk jejak audit — hanya
--      ditandai, tidak dihapus.
--   4. Petugas/Admin input ulang entry yang benar lewat form yang sudah ada.
--
-- Ini sengaja BUKAN direct-edit: mengubah field entry secara langsung
-- berarti "sumber kebenaran" transaksi bisa berubah tanpa jejak yang jelas,
-- yang melemahkan kontrol internal dibanding pola void+repost standar
-- accounting ledger.
--
-- Safe to re-run.

alter table so_entries add column if not exists voided_at timestamptz;
alter table so_entries add column if not exists voided_by text;
alter table so_entries add column if not exists void_reason text;

alter table rimpilan_entries add column if not exists voided_at timestamptz;
alter table rimpilan_entries add column if not exists voided_by text;
alter table rimpilan_entries add column if not exists void_reason text;

-- Speeds up "exclude voided" filters used everywhere entries are summed.
create index if not exists idx_so_entries_voided_at on so_entries (session_id, voided_at);
create index if not exists idx_rimpilan_entries_voided_at on rimpilan_entries (session_id, voided_at);
