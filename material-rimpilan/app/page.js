'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { PLANTS } from '../lib/plants';

export default function DashboardPage() {
  const [materials, setMaterials] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: mats }, { data: tx }] = await Promise.all([
      supabase.from('mr_materials').select('*'),
      supabase
        .from('mr_transaksi')
        .select('*, mr_materials(kode_material, nama_material, satuan, plant)')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    setMaterials(mats || []);
    setRecent(tx || []);
    setLoading(false);
  }

  const totalJenis = materials.length;
  const totalStok = materials.reduce((s, m) => s + Number(m.stok || 0), 0);
  const perPlant = PLANTS.map((p) => {
    const items = materials.filter((m) => m.plant === p);
    return {
      plant: p,
      jenis: items.length,
      stok: items.reduce((s, m) => s + Number(m.stok || 0), 0),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-ink/60">Ringkasan stok Material Rimpilan.</p>
      </div>

      {loading ? (
        <div className="text-sm text-ink/50">Memuat...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <div className="card p-5">
              <div className="text-xs text-ink/50">Total Jenis Material</div>
              <div className="mt-1 font-mono text-3xl font-semibold">{totalJenis}</div>
            </div>
            <div className="card p-5">
              <div className="text-xs text-ink/50">Total Stok (semua satuan)</div>
              <div className="mt-1 font-mono text-3xl font-semibold">{totalStok}</div>
            </div>
          </div>

          <div className="card p-5">
            <div className="mb-3 text-sm font-medium">Stok per RDC</div>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink/50">
                <tr>
                  <th className="pb-2 pr-3">RDC</th>
                  <th className="pb-2 pr-3 text-right">Jenis Material</th>
                  <th className="pb-2 pr-3 text-right">Total Stok</th>
                </tr>
              </thead>
              <tbody>
                {perPlant.map((p) => (
                  <tr key={p.plant} className="border-t border-line">
                    <td className="py-2 pr-3">{p.plant}</td>
                    <td className="py-2 pr-3 text-right font-mono">{p.jenis}</td>
                    <td className="py-2 pr-3 text-right font-mono">{p.stok}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-5">
            <div className="mb-3 text-sm font-medium">Riwayat Transaksi Terbaru</div>
            {recent.length === 0 ? (
              <div className="text-sm text-ink/40">Belum ada transaksi.</div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-ink/50">
                  <tr>
                    <th className="pb-2 pr-3">Tanggal</th>
                    <th className="pb-2 pr-3">RDC</th>
                    <th className="pb-2 pr-3">Material</th>
                    <th className="pb-2 pr-3">Tipe</th>
                    <th className="pb-2 pr-3 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.id} className="border-t border-line">
                      <td className="py-2 pr-3">{new Date(t.tanggal).toLocaleDateString('id-ID')}</td>
                      <td className="py-2 pr-3">{t.mr_materials?.plant}</td>
                      <td className="py-2 pr-3">
                        {t.mr_materials?.nama_material}
                        <span className="ml-1 font-mono text-xs text-ink/40">{t.mr_materials?.kode_material}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`badge ${t.tipe === 'masuk' ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'}`}>
                          {t.tipe === 'masuk' ? 'Barang Masuk' : 'Barang Keluar'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {t.tipe === 'masuk' ? '+' : '-'}{t.qty} {t.mr_materials?.satuan}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
