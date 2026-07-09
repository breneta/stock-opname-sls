# Warehouse Suite

Satu repository, dua aplikasi terpisah, satu Supabase backend:

```
warehouse-suite/
├── apps/
│   ├── stock-opname/          → Finance & Warehouse: Stock Opname RDC
│   └── material-rimpilan/     → Manajemen Material di luar SAP
├── supabase/
│   └── schema.sql             → jalankan sekali di Supabase SQL editor
└── README.md
```

Kedua app independen satu sama lain — masing-masing punya `package.json`, `node_modules`,
dan di-deploy sebagai Vercel project terpisah. Yang mereka bagi hanyalah satu Supabase
project (satu URL + anon key), jadi datanya hidup di tempat yang sama tapi kodenya
tidak saling bercampur.

## 1. Setup Supabase (sekali saja)

1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, tempel isi `supabase/schema.sql`, lalu **Run**.
   Ini membuat semua tabel untuk kedua app + trigger yang otomatis menjaga
   stok Material Rimpilan tetap sinkron dengan riwayat transaksi.
3. Ambil **Project URL** dan **anon public key** dari Settings → API.

> Catatan keamanan: schema ini mengaktifkan RLS dengan policy "allow all" supaya
> app langsung jalan tanpa setup auth tambahan. Ini cocok untuk tool internal yang
> hanya bisa diakses tim Finance/Warehouse. Kalau nanti perlu extra proteksi
> (misalnya login per role), policy ini yang perlu diperketat duluan.

## 2. Jalankan tiap app secara lokal

```bash
cd apps/stock-opname
cp .env.local.example .env.local   # isi dengan URL + anon key dari langkah 1
npm install
npm run dev                         # http://localhost:3000
```

```bash
cd apps/material-rimpilan
cp .env.local.example .env.local   # pakai URL + anon key yang SAMA
npm install
npm run dev
```

## 3. Deploy ke Vercel (2 project terpisah, 1 repo)

Push repo ini ke GitHub, lalu di Vercel:

1. **Import Project** → pilih repo ini.
2. Saat diminta **Root Directory**, pilih `apps/stock-opname` → set environment
   variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) → Deploy.
3. **Import Project** lagi dari repo yang sama → kali ini Root Directory
   `apps/material-rimpilan` → env variables sama → Deploy.

Hasilnya: 2 URL Vercel berbeda, 2 deployment independen, tapi keduanya baca/tulis
ke Supabase yang sama — jadi kalau besok mau tambah app ke-3 (misal, dashboard
gabungan), tinggal baca dari tabel yang sudah ada.

## Kalau Supabase-nya sudah pernah di-setup sebelumnya

`supabase/schema.sql` sekarang aman di-run ulang di project Supabase yang sama —
bagian migrasi di paling bawah otomatis menambahkan kolom baru (`plant` di
session & Master Rimpilan, `nomor_rak`, `batch`, `source` di scan) tanpa
menghapus data yang sudah ada. Tinggal paste ulang seluruh isi file dan Run.

Kalau setelah run masih muncul error seperti "Could not find the 'x' column in
the schema cache", jalankan `NOTIFY pgrst, 'reload schema';` di SQL Editor, atau
klik "Reload schema cache" di Project Settings -> API -- itu tandanya schema-nya
sudah benar tapi cache Supabase-nya belum refresh.

## Kode Plant SAP

Kolom RDC/Plant di Upload Data SAP maupun Upload Master Rimpilan menerima dua
format: nama RDC ("RDC Jakarta") atau kode Plant SAP mentah, otomatis
diterjemahkan:

| Kode | RDC |
|------|-----|
| D104 | RDC Jakarta |
| D105 | RDC Surabaya |
| D106 | RDC Semarang |
| D107 | RDC Denpasar |
| D108 | RDC Palembang |

Ubah mapping ini di `lib/plants.js` masing-masing app kalau ada penambahan RDC.

## Apa yang sudah jalan

**Stock Opname** — upload Data SAP (.xlsx), buat Session per RDC, input hasil hitung
fisik (append-only, tidak pernah overwrite), rekonsiliasi otomatis vs Data SAP,
dashboard progress, filter, export Excel, history session. Halaman **Input**
sekarang mengecek dua sumber sekaligus: Data SAP dulu, lalu Master Material
Rimpilan (RDC yang sama dengan session) — jadi petugas pallet dan Rimpilan
cukup satu alur input, satu app.

**Material Rimpilan** — master material per RDC (dengan Nomor Rak), upload data
master lewat Excel (mirip alur upload SAP), Barang Masuk/Keluar dengan input
ketik (bukan dropdown) yang otomatis menampilkan Nomor Rak & stok, stok yang
auto-update lewat database trigger (bukan dihitung manual di frontend, jadi
tidak bisa drift), dashboard per RDC, riwayat lengkap dengan filter, export Excel.

**Rekonsiliasi Rimpilan** — di dalam session Stock Opname, ada halaman
Rekonsiliasi Rimpilan terpisah yang membandingkan hasil hitung fisik terhadap
stok Master Rimpilan (bukan Data SAP). Kalau ada selisih, tombol "Sesuaikan
Stok" langsung membuat transaksi koreksi di Material Rimpilan.

## Kalau mau lanjutin development

Karena ini dua aplikasi produksi yang bakal terus berkembang (role-based access,
notifikasi, dsb.), development lanjutan lebih nyaman lewat **Claude Code** —
bisa langsung baca & edit file di repo ini, jalankan `npm run dev`, dan lihat
error build sebelum push ke Vercel.
