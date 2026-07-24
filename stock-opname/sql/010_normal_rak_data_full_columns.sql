-- Master Rak Normal SO — restructured to be self-contained, same shape as
-- rimpilan_sap_data, instead of a thin 3-column mapping joined against
-- so_sap_data at read time. Reasons for the change:
--   1) Format sekarang sama persis dengan Upload Data Master Rimpilan —
--      satu pola template buat Accounting, bukan dua pola berbeda.
--   2) Menghindari risiko mismatch join (material+batch harus persis sama
--      antara file rak dan Data SAP, gampang meleset kalau beda file).
-- so_sap_data tetap satu-satunya sumber Qty SAP untuk rekonsiliasi — kolom
-- qty di sini murni ikut format Rimpilan, tidak dipakai untuk hitung
-- selisih (itu tetap dari so_sap_data + so_entries seperti biasa).
--
-- Safe to re-run.

alter table normal_rak_data add column if not exists material_description text;
alter table normal_rak_data add column if not exists plant text;
alter table normal_rak_data add column if not exists storage_location text;
alter table normal_rak_data add column if not exists base_uom text;
alter table normal_rak_data add column if not exists qty numeric not null default 0;
