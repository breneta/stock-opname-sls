'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { buildReconciliation } from '../../../../lib/reconciliation';

export default function SessionHubPage() {
  const { id } = useParams();
  const [session, setSession] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const [{ data: sessionData }, { data: sapData }, { data: entries }] = await Promise.all([
      supabase.from('so_sessions').select('*').eq('id', id).single(),
      supabase.from('so_sap_data').select('*').eq('session_id', id),
      supabase.from('so_entries').select('*').eq('session_id', id),
    ]);

    setSession(sessionData);

    // Only materials with actual stock (Qty > 0) count toward "Total
    // Material" — rows with Qty 0 are still in SAP data for reference
    // but don't need a physical count.
    const sap = (sapData || []).filter((r) => Number(r.qty) > 0);
    const { rows, notYetScanned } = buildReconciliation(sap, entries || []);

    const totalMaterialSap = sap.length;
    const materialBelumDiinput = notYetScanned.length;
    const materialSudahDiinput = totalMaterialSap - materialBelumDiinput;
    const materialSelisih = rows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang').length;
    const notFoundCount = rows.filter((r) => r.status === 'Tidak Ada di SAP').length;
    const progress = totalMaterialSap > 0 ? Math.round((materialSudahDiinput / totalMaterialSap) * 100) : 0;

    // Qty can't be summed across different units (BOX vs PC vs AU, etc.)
    // so everything Qty-related is broken down per Base Unit of Measure.
    const qtyByUom = new Map();
    for (const r of sap) {
      const uom = r.base_uom || '(tanpa satuan)';
      const cur = qtyByUom.get(uom) || { uom, qtySap: 0, qtyLebih: 0, qtyKurang: 0 };
      cur.qtySap += Number(r.qty) || 0;
      qtyByUom.set(uom, cur);
    }
    for (const r of rows) {
      if (r.selisih === 0) continue;
      const uom = r.base_uom || '(tanpa satuan)';
      const cur = qtyByUom.get(uom) || { uom, qtySap: 0, qtyLebih: 0, qtyKurang: 0 };
      if (r.selisih > 0) cur.qtyLebih += r.selisih;
      else cur.qtyKurang += Math.abs(r.selisih);
      qtyByUom.set(uom, cur);
    }

    setStats({
      totalMaterialSap,
      materialSudahDiinput,
      materialBelumDiinput,
      materialSelisih,
      notFoundCount,
      qtyByUom: [...qtyByUom.values()].sort((a, b) => a.uom.localeCompare(b.uom)),
      progress,
      hasSapData: (sapData || []).length > 0,
    });
    setLoading(false);
  }

  async function handleCloseSession() {
    if (!confirm('Tutup session ini? Session yang ditutup masih bisa dilihat di History.')) return;
    await supabase.from('so_sessions').update({ status: 'closed' }).eq('id', id);
    load();
  }

  if (loading) return <div className="text-sm text-ink/50">Memuat session...</div>;
  if (!session) return <div className="text-sm text-bad">Session tidak ditemukan.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/admin" className="text-xs text-ink/50 hover:text-ink">← Semua Session</Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{session.name}</h1>
            {session.plant && <span className="badge bg-slate-850/10 text-ink">{session.plant}</span>}
          </div>
        </div>
        {session.status === 'active' && (
          <button onClick={handleCloseSession} className="btn-ghost text-xs">Tutup Session</button>
        )}
      </div>

      {!stats.hasSapData ? (
        <div className="card border-amber/40 bg-amber/10 p-5">
          <div className="font-medium">Belum ada Data SAP</div>
          <p className="mt-1 text-sm text-ink/60">
            Upload Data SAP terlebih dahulu sebelum memulai Stock Opname.
          </p>
          <Link href={`/admin/sessions/${id}/upload`} className="btn-primary mt-4 inline-flex">
            Upload Data SAP
          </Link>
        </div>
      ) : (
        <>
          {stats.notFoundCount > 0 && (
            <Link
              href={`/admin/sessions/${id}/reconciliation?status=${encodeURIComponent('Tidak Ada di SAP')}`}
              className="card flex items-center justify-between border-bad/30 bg-bad/5 p-4 transition hover:shadow-md"
            >
              <div className="flex items-center gap-2 text-sm text-bad">
                <BellDotIcon />
                <span>
                  <strong className="font-semibold">{stats.notFoundCount} material</strong> discan tapi tidak ditemukan di Data SAP.
                </span>
              </div>
              <span className="text-xs font-medium text-bad">Lihat →</span>
            </Link>
          )}

          <div className="card p-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Progress Stock Opname</span>
              <span className="font-mono text-ink/60">{stats.progress}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-slate-850 transition-all"
                style={{ width: `${stats.progress}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Sudah Diinput" value={stats.materialSudahDiinput} tone="good" />
            <StatCard label="Belum Diinput" value={stats.materialBelumDiinput} tone="warn" />
            <StatCard label="Material Selisih" value={stats.materialSelisih} tone="bad" />
            <StatCard label="Tidak Ada di SAP" value={stats.notFoundCount} tone="bad" />
          </div>

          {stats.qtyByUom.length > 0 && (
            <div className="card p-5">
              <div className="mb-3 text-sm font-medium">Qty per Base Unit of Measure</div>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-ink/50">
                  <tr>
                    <th className="pb-2 pr-3">UoM</th>
                    <th className="pb-2 pr-3 text-right">Qty SAP</th>
                    <th className="pb-2 pr-3 text-right">Qty Lebih</th>
                    <th className="pb-2 pr-3 text-right">Qty Kurang</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.qtyByUom.map((r) => (
                    <tr key={r.uom} className="border-t border-line">
                      <td className="py-2 pr-3 font-mono">{r.uom}</td>
                      <td className="py-2 pr-3 text-right font-mono">{r.qtySap}</td>
                      <td className="py-2 pr-3 text-right font-mono text-warn">{r.qtyLebih || 0}</td>
                      <td className="py-2 pr-3 text-right font-mono text-bad">{r.qtyKurang || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <ActionLink
              href={`/admin/sessions/${id}/reconciliation`}
              title="Rekonsiliasi"
              desc="Bandingkan hasil hitung dengan Data SAP"
            />
            <ActionLink
              href={`/admin/sessions/${id}/upload`}
              title="Upload Data SAP"
              desc="Tambah atau perbarui Data SAP session ini"
            />
            <ExportAction sessionId={id} sessionName={session.name} />
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const toneClass = { good: 'text-good', warn: 'text-warn', bad: 'text-bad' }[tone] || 'text-ink';
  return (
    <div className="card p-4">
      <div className="text-xs text-ink/50">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function BellDotIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function ActionLink({ href, title, desc }) {
  return (
    <Link href={href} className="card block p-4 transition hover:border-slate-850/30 hover:shadow-md">
      <div className="font-medium">{title}</div>
      <div className="mt-0.5 text-sm text-ink/50">{desc}</div>
    </Link>
  );
}

function ExportAction({ sessionId, sessionName }) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    const mod = await import('../../../../lib/exportExcel');
    await mod.exportSessionToExcel(sessionId, sessionName);
    setExporting(false);
  }

  return (
    <button onClick={handleExport} disabled={exporting} className="card block p-4 text-left transition hover:border-slate-850/30 hover:shadow-md disabled:opacity-60">
      <div className="font-medium">{exporting ? 'Menyiapkan file...' : 'Export Excel'}</div>
      <div className="mt-0.5 text-sm text-ink/50">Summary, Selisih, Semua Data, Detail Scan</div>
    </button>
  );
}
