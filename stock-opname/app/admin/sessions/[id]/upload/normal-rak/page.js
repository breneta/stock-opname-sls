'use client';

// SUPERSEDED — do not use.
//
// Master Rak Normal SO (upload file material+batch+rak lengkap per material,
// disimpan di tabel normal_rak_data) sudah di-drop. Untuk Normal SO, rak
// tiap material sekarang diambil otomatis dari histori input tim lapangan
// (so_entries), bukan dari file upload — sama seperti sebelum fitur ini ada.
// Warehouse Racks (Upload Warehouse Racks, tabel warehouse_racks) tetap
// dipakai, tapi hanya sebagai daftar kode rak per gudang untuk suggestion
// combobox "Nomor Rak", bukan sebagai penentu material apa yang ada di rak
// mana.
//
// File ini sengaja tidak dihapus (file di Downloads tidak bisa dihapus/
// di-rename dari sini) — cukup dinetralkan jadi halaman redirect. Rute nav
// ke halaman ini juga sudah dihapus dari app/admin/sessions/[id]/upload/page.js.
// Lihat sql/011_normal_rak_data_deprecated.sql untuk catatan deprecation
// tabel normal_rak_data.

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function DeprecatedNormalRakUploadPage() {
  const { id } = useParams();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/admin/sessions/${id}/upload`);
  }, [id, router]);

  return (
    <div className="mx-auto max-w-lg p-5 text-sm text-ink/60">
      Halaman ini sudah tidak dipakai — mengalihkan ke Upload Data SAP...
    </div>
  );
}
