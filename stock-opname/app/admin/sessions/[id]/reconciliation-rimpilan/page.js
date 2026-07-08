'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '../../../../../lib/supabaseClient';
import { buildRimpilanReconciliation } from '../../../../../lib/reconciliationRimpilan';

export default function ReconciliationRimpilanPage() {
  const { id } = useParams();
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailRow, setDetailRow] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const { data: sessionData } = await supabase.from('so_sessions').select('*').eq('id', id).single();
    setSession(sessionData);

    if (!sessionData?.plant) {
      setRows([]);
      setLoading(false);
      return;
    }

    const [{ data: master }, { data: entries }] = await Promise.all([
      supabase.from('mr_materials').select('*').eq('plant', sessionData.plant),
      supabase.from('so_entries').select('*').eq('session_id', id).eq('source', 'rimpilan'),
    ]);

    const { rows } = buildRimpilanReconciliation(master || [], entries || []);
    setRows(rows);
    setLoading(false);
  }

  async function handleAdjust(row) {
    if (!row.materialId) return;
    if (!confirm(
      `Sesuaikan stok "${row.material_description}" dari ${row.stok_master} menjadi ${row.total_qty_fisik} ${row.satuan}?`
    )) return;

    setAdjusting(row.material);
    const diff = row.total_qty_fisik - row.stok_master;
    const { error } = await supabase.from('mr_transaksi').insert({
      material_id: row.materialId,
      tipe: diff > 0 ? 'masuk' : 'keluar',
      tanggal: new Date().toISOString().slice(0, 10),
      qty: Math.abs(diff),
      keterangan: `Penyesuaian Stock Opname — ${session?.name || ''}`,
    });
    setAdjusting(null);
    if (error) {
      setMessage({ type: 'error', text: error.message });
      return;
    }
    setMessage({ type: 'success', text: `Stok "${row.material_description}" berhasil disesuaikan.` });
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/admin/sessions/${id}`} className="text-xs text-ink/50 hover:text-ink">← Dashboard</Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Rekonsiliasi Rimpilan</h1>
          <p className="mt-1 text-sm text-ink/60">
            Dibandingkan terhadap stok Master Material Rimpilan{session?.plant ? ` di ${session.plant}` : ''}.
          </p>
        </div>
        <Link href={`/admin/sessions/${id}/reconciliation`} className="text-xs font-medium text-slate-850 hover:underline">
          Lihat Rekonsiliasi SAP →
        </Link>
      </div>

      {message && (
        <div className={`card p-3 text-sm ${message.type === 'error' ? 'border-bad/30 bg-bad/5 text-bad' : 'border-good/30 bg-good/5 text-good'}`}>
          {message.text}
        </div>
      )}

      {!session?.plant ? (
        <div className="card p-6 text-center text-sm text-ink/50">
          Session ini belum punya RDC. Set RDC lewat session baru untuk mengaktifkan jalur Rimpilan.
        </div>
      ) : loading ? (
        <div className="text-sm text-ink/50">Memuat...</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper text-xs text-ink/50">
              <tr>
                <th className="px-4 py-2.5">Kode</th>
                <th className="px-4 py-2.5">Nama</th>
                <th className="px-4 py-2.5">Rak</th>
                <th className="px-4 py-2.5 text-right">Stok Master</th>
                <th className="px-4 py-2.5 text-right">Qty Fisik</th>
                <th className="px-4 py-2.5 text-right">Selisih</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-4 py-2.5 font-mono">{r.material}</td>
                  <td className="px-4 py-2.5">{r.material_description}</td>
                  <td className="px-4 py-2.5 font-mono">{r.nomor_rak}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.stok_master} {r.satuan}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.total_qty_fisik} {r.satuan}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.selisih}</td>
                  <td className="px-4 py-2.5">
                    <RimpilanStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setDetailRow(r)} className="text-xs font-medium text-slate-850 hover:underline">
                        Detail
                      </button>
                      {r.status !== 'Sesuai' && r.materialId && (
                        <button
                          onClick={() => handleAdjust(r)}
                          disabled={adjusting === r.material}
                          className="text-xs font-medium text-teal-700 hover:underline disabled:opacity-50"
                        >
                          {adjusting === r.material ? 'Menyesuaikan...' : 'Sesuaikan Stok'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-ink/40">Belum ada scan Rimpilan di session ini.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="font-mono text-sm font-semibold">{detailRow.material}</div>
                <div className="text-xs text-ink/50">{detailRow.material_description}</div>
              </div>
              <button onClick={() => setDetailRow(null)} className="text-ink/40 hover:text-ink">✕</button>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="text-ink/50">
                <tr>
                  <th className="pb-2 pr-3">Waktu</th>
                  <th className="pb-2 pr-3">Petugas</th>
                  <th className="pb-2 pr-3 text-right">Qty</th>
                  <th className="pb-2 pr-3">Kondisi</th>
                  <th className="pb-2 pr-3">Catatan</th>
                </tr>
              </thead>
              <tbody>
                {detailRow.entries.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(e.created_at).toLocaleString('id-ID')}</td>
                    <td className="py-2 pr-3">{e.petugas_nama}</td>
                    <td className="py-2 pr-3 text-right font-mono">{e.qty_fisik}</td>
                    <td className="py-2 pr-3">{e.kondisi_barang}</td>
                    <td className="py-2 pr-3">{e.catatan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RimpilanStatusBadge({ status }) {
  const styles = {
    Sesuai: 'bg-good/10 text-good',
    Lebih: 'bg-amber/20 text-warn',
    Kurang: 'bg-bad/10 text-bad',
    'Tidak Ada di Master': 'bg-ink/10 text-ink/70',
  };
  return <span className={`badge ${styles[status] || 'bg-ink/10 text-ink/70'}`}>{status}</span>;
}
