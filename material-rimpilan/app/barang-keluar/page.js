'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import TransaksiForm from '../../components/TransaksiForm';

export default function BarangKeluarPage() {
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase
      .from('mr_transaksi')
      .select('*, mr_materials(kode_material, nama_material, satuan, plant)')
      .eq('tipe', 'keluar')
      .order('created_at', { ascending: false })
      .limit(15);
    setRecent(data || []);
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div>
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Barang Keluar</h1>
        <p className="mb-5 text-sm text-ink/60">Stok akan otomatis berkurang setelah disimpan.</p>
        <TransaksiForm tipe="keluar" onSaved={load} />
      </div>
      <div>
        <div className="mb-2 text-sm font-medium text-ink/70">Transaksi Terbaru</div>
        <div className="card divide-y divide-line">
          {recent.length === 0 && <div className="p-4 text-sm text-ink/40">Belum ada transaksi.</div>}
          {recent.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-3.5 text-sm">
              <div>
                <div className="font-medium">{t.mr_materials?.nama_material}</div>
                <div className="text-xs text-ink/40">{t.mr_materials?.plant} · {new Date(t.tanggal).toLocaleDateString('id-ID')} · {t.keterangan}</div>
              </div>
              <div className="font-mono text-bad">-{t.qty} {t.mr_materials?.satuan}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
