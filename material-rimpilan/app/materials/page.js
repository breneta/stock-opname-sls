'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { exportMaterialsToExcel } from '../../lib/exportExcel';

export default function MaterialsPage() {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('mr_materials').select('*').order('nama_material');
    setMaterials(data || []);
    setLoading(false);
  }

  async function handleDelete(m) {
    if (!confirm(`Hapus material "${m.nama_material}"? Riwayat transaksinya juga akan terhapus.`)) return;
    await supabase.from('mr_materials').delete().eq('id', m.id);
    load();
  }

  const filtered = materials.filter((m) =>
    `${m.kode_material} ${m.nama_material}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Master Material Rimpilan</h1>
          <p className="mt-1 text-sm text-ink/60">Material yang tidak terdapat pada SAP.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportMaterialsToExcel(materials)} className="btn-ghost">Export Excel</button>
          <Link href="/materials/new" className="btn-teal">+ Tambah Material</Link>
        </div>
      </div>

      <input
        className="input-field max-w-sm"
        placeholder="Cari kode atau nama material..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <div className="text-sm text-ink/50">Memuat...</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper text-xs text-ink/50">
              <tr>
                <th className="px-4 py-2.5">Kode</th>
                <th className="px-4 py-2.5">Nama Material</th>
                <th className="px-4 py-2.5">Satuan</th>
                <th className="px-4 py-2.5 text-right">Stok</th>
                <th className="px-4 py-2.5">Keterangan</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-4 py-2.5 font-mono">{m.kode_material}</td>
                  <td className="px-4 py-2.5">{m.nama_material}</td>
                  <td className="px-4 py-2.5">{m.satuan}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{m.stok}</td>
                  <td className="px-4 py-2.5 text-ink/60">{m.keterangan}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-2">
                      <Link href={`/materials/${m.id}/edit`} className="text-xs font-medium text-slate-850 hover:underline">Edit</Link>
                      <button onClick={() => handleDelete(m)} className="btn-danger">Hapus</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/40">Belum ada material.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
