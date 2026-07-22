'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../../lib/supabaseClient';
import { buildReconciliation } from '../../../../../lib/reconciliation';
import { fetchAll } from '../../../../../lib/fetchAll';
import StatusBadge from '../../../../../components/StatusBadge';

export default function ReconciliationPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailRow, setDetailRow] = useState(null);

  const [filterPlant, setFilterPlant] = useState('');
  const [filterStorage, setFilterStorage] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [filterStatus, setFilterStatus] = useState(() => searchParams.get('status') || '');
  const [filterKondisi, setFilterKondisi] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const [sapData, entries] = await Promise.all([
      fetchAll(() => supabase.from('so_sap_data').select('*').eq('session_id', id)),
      fetchAll(() => supabase.from('so_entries').select('*').eq('session_id', id)),
    ]);
    const sap = (sapData || []).filter((r) => Number(r.qty) > 0);
    const { rows } = buildReconciliation(sap, entries || []);
    setRows(rows);
    setLoading(false);
  }

  const plants = useMemo(() => [...new Set(rows.map((r) => r.plant).filter(Boolean))], [rows]);
  const storages = useMemo(() => [...new Set(rows.map((r) => r.storage_location).filter(Boolean))], [rows]);
  const kondisiSet = useMemo(() => {
    const s = new Set();
    rows.forEach((r) => r.entries.forEach((e) => s.add(e.kondisi_barang)));
    return [...s];
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (filterPlant && r.plant !== filterPlant) return false;
    if (filterStorage && r.storage_location !== filterStorage) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    if (filterKondisi && !r.entries.some((e) => e.kondisi_barang === filterKondisi)) return false;
    if (search && !`${r.material} ${r.material_description}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/admin/sessions/${id}`} className="text-xs text-ink/50 hover:text-ink">← Dashboard</Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Rekonsiliasi</h1>
      </div>

      <div className="card grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-5">
        <input
          className="input-field col-span-2 sm:col-span-1 md:col-span-1"
          placeholder="Cari material..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={filterPlant} onChange={setFilterPlant} options={plants} placeholder="Plant" />
        <Select value={filterStorage} onChange={setFilterStorage} options={storages} placeholder="Storage Loc." />
        <Select value={filterStatus} onChange={setFilterStatus} options={['Sesuai', 'Lebih', 'Kurang', 'Tidak Ada di SAP']} placeholder="Status" />
        <Select value={filterKondisi} onChange={setFilterKondisi} options={kondisiSet} placeholder="Kondisi" />
      </div>

      {loading ? (
        <div className="text-sm text-ink/50">Memuat...</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper text-xs text-ink/50">
              <tr>
                <th className="px-4 py-2.5">Material</th>
                <th className="px-4 py-2.5">Batch</th>
                <th className="px-4 py-2.5">Plant</th>
                <th className="px-4 py-2.5">Storage Loc.</th>
                <th className="px-4 py-2.5">UoM</th>
                <th className="px-4 py-2.5 text-right">Qty SAP</th>
                <th className="px-4 py-2.5 text-right">Qty Fisik</th>
                <th className="px-4 py-2.5 text-right">Selisih</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-4 py-2.5 font-mono">{r.material}</td>
                  <td className="px-4 py-2.5 font-mono">{r.batch}</td>
                  <td className="px-4 py-2.5">{r.plant}</td>
                  <td className="px-4 py-2.5">{r.storage_location}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.base_uom}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.qty_sap}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.total_qty_fisik}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.selisih}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => setDetailRow(r)} className="text-xs font-medium text-slate-850 hover:underline">
                      Detail Scan
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-ink/40">Tidak ada data.</td></tr>
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
                  <th className="pb-2 pr-3">Rak</th>
                  <th className="pb-2 pr-3 text-right">Qty</th>
                  <th className="pb-2 pr-3">UoM</th>
                  <th className="pb-2 pr-3">Kondisi</th>
                  <th className="pb-2 pr-3">Catatan</th>
                </tr>
              </thead>
              <tbody>
                {detailRow.entries.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(e.created_at).toLocaleString('id-ID')}</td>
                    <td className="py-2 pr-3">{e.petugas_nama}</td>
                    <td className="py-2 pr-3 font-mono">{e.nomor_rak}</td>
                    <td className="py-2 pr-3 text-right font-mono">{e.qty_fisik}</td>
                    <td className="py-2 pr-3 font-mono">{e.base_uom}</td>
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

function Select({ value, onChange, options, placeholder }) {
  return (
    <select className="input-field" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
