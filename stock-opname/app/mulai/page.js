'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export default function MulaiStockOpname() {
  // 1. State untuk menyimpan data inputan form
  const [isManual, setIsManual] = useState(false); // Status apakah material baru/manual
  const [materialCode, setMaterialCode] = useState('');
  const [materialName, setMaterialName] = useState('');
  const [unitMeasure, setUnitMeasure] = useState('');
  const [quantity, setQuantity] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // 2. Fungsi saat tombol "Simpan Data" diklik
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    // Gabungkan data yang diisi petugas untuk dikirim ke Supabase
    const dataDataToSave = {
      material_code: materialCode,
      material_name: materialName,
      base_uom: unitMeasure, // Isinya akan otomatis "PC" atau "BOX"
      qty_fisik: Number(quantity),
      is_manual_input: isManual, // Menandakan di database kalau ini barang gaib/baru
      created_at: new Date().toISOString(),
    };

    console.log("Data yang siap dikirim ke Supabase:", dataDataToSave);
    
    // NOTIFIKASI SIMULASI (Nanti bagian ini yang dihubungkan ke Supabase Anda)
    setTimeout(() => {
      setLoading(false);
      setMessage('✅ Data Stock Opname berhasil disimpan!');
      // Reset form setelah berhasil simpan
      if (isManual) {
        setMaterialCode('');
        setMaterialName('');
      }
      setQuantity('');
    }, 1000);
  };

  return (
    <div className="mx-auto max-w-md p-4">
      {/* Tombol Kembali ke Halaman Utama */}
      <Link href="/" className="text-sm text-teal hover:underline mb-6 inline-block">
        ← Kembali ke Menu Utama
      </Link>

      <div className="bg-white border border-line rounded-lg p-6 shadow-sm">
        <h1 className="text-xl font-bold text-ink mb-2">Input Hasil Hitung Fisik</h1>
        <p className="text-sm text-ink/60 mb-6">Masukkan data pemeriksaan barang di gudang.</p>

        {/* Pilihan jika barang tidak ada di SAP */}
        <div className="flex items-center space-x-3 p-3 bg-amber/10 border border-amber/30 rounded-md mb-6">
          <input
            type="checkbox"
            id="is-manual"
            checked={isManual}
            onChange={(e) => {
              setIsManual(e.target.checked);
              // Reset isi jika ganti mode
              setMaterialCode('');
              setMaterialName('');
            }}
            className="w-4 h-4 text-teal border-line rounded focus:ring-teal"
          />
          <label htmlFor="is-manual" className="text-sm font-medium text-warn select-none cursor-pointer">
            ⚠️ Material tidak ada di Master SAP (Input Manual)
          </label>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Kolom KODE BARANG */}
          <div className="flex flex-col space-y-1">
            <label className="text-sm font-semibold text-ink">Kode Material</label>
            <input
              type="text"
              placeholder={isManual ? "Ketik kode baru..." : "Ketik atau cari kode SAP..."}
              value={materialCode}
              onChange={(e) => setMaterialCode(e.target.value)}
              required
              className="border border-line rounded-md bg-paper text-ink px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal text-sm"
            />
          </div>

          {/* Kolom NAMA BARANG */}
          <div className="flex flex-col space-y-1">
            <label className="text-sm font-semibold text-ink">Nama Material</label>
            <input
              type="text"
              placeholder={isManual ? "Ketik nama barang baru..." : "Nama otomatis dari SAP..."}
              value={materialName}
              onChange={(e) => setMaterialName(e.target.value)}
              disabled={!isManual} // Jika dari SAP, kolom ini terkunci (otomatis)
              required
              className={`border border-line rounded-md text-ink px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal text-sm ${
                !isManual ? 'bg-line/50 opacity-70 cursor-not-allowed' : 'bg-paper'
              }`}
            />
          </div>

          {/* Kolom DROPDOWN UNIT MEASURE (Sesuai Request Anda) */}
          <div className="flex flex-col space-y-1">
            <label htmlFor="base-uom" className="text-sm font-semibold text-ink">Base of Unit Measure</label>
            <select
              id="base-uom"
              value={unitMeasure}
              onChange={(e) => setUnitMeasure(e.target.value)}
              required
              className="w-full border border-line rounded-md bg-paper text-ink px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal text-sm"
            >
              <option value="" disabled>Pilih Unit...</option>
              <option value="PC">PC</option>
              <option value="BOX">BOX</option>
            </select>
          </div>

          {/* Kolom JUMLAH FISIK */}
          <div className="flex flex-col space-y-1">
            <label className="text-sm font-semibold text-ink">Jumlah Fisik di Gudang</label>
            <input
              type="number"
              placeholder="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
              min="0"
              className="border border-line rounded-md bg-paper text-ink px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal text-sm"
            />
          </div>

          {/* Pesan Sukses */}
          {message && (
            <p className="text-sm font-medium text-good bg-good/10 p-2 rounded text-center">
              {message}
            </p>
          )}

          {/* Tombol Simpan */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-teal hover:bg-teal-700 text-white font-medium py-2 px-4 rounded-md transition shadow-sm text-sm disabled:opacity-50"
          >
            {loading ? 'Menyimpan...' : 'Simpan Hasil Hitung'}
          </button>

        </form>
      </div>
    </div>
  );
}
