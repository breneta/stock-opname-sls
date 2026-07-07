'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { exportRiwayatToExcel } from '../../lib/exportExcel';

export default function RiwayatPage() {
  const [tx, setTx] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTipe, setFilterTipe] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('mr_transaksi')
      .select('*, mr_materials(kode_material, nama_material, satuan)')
      .order('created_at', { ascending: false });
    setTx(data || []);
    setLoading(false);
  }

  const filtered = tx.filter((t) => {
    if (filterTipe && t.tipe !== filterTipe) return false;
    const label = `${t.mr_materials?.kode_material} ${t.mr_materials?.nama_material}`.toLowerCase();
    if (search && !label.includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Riwayat Transaksi</h1>
          <p className="mt-1 text-sm text-ink/60">Seluruh histori Barang Masuk dan Barang Keluar.</p>
        </div>
        <button onClick={() => exportRiwayatToExcel(tx)} className="btn-ghost">Export Excel</button>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          className="input-field max-w-xs"
          placeholder="Cari material..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input-field max-w-[180px]" value={filterTipe} onChange={(e) => setFilterTipe(e.target.value)}>
          <option value="">Semua Tipe</option>
          <option value="masuk">Barang Masuk</option>
          <option value="keluar">Barang Keluar</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-ink/50">Memuat...</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper text-xs text-ink/50">
              <tr>
                <th className="px-4 py-2.5">Tanggal</th>
                <th className="px-4 py-2.5">Jam</th>
                <th className="px-4 py-2.5">Material</th>
                <th className="px-4 py-2.5">Tipe</th>
                <th className="px-4 py-2.5 text-right">Qty</th>
                <th className="px-4 py-2.5">Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-4 py-2.5">{new Date(t.tanggal).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{new Date(t.created_at).toLocaleTimeString('id-ID')}</td>
                  <td className="px-4 py-2.5">
                    {t.mr_materials?.nama_material}
                    <span className="ml-1 font-mono text-xs text-ink/40">{t.mr_materials?.kode_material}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`badge ${t.tipe === 'masuk' ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'}`}>
                      {t.tipe === 'masuk' ? 'Masuk' : 'Keluar'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{t.qty} {t.mr_materials?.satuan}</td>
                  <td className="px-4 py-2.5 text-ink/60">{t.keterangan}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/40">Tidak ada data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
