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

    const sap = sapData || [];
    const { rows, notYetScanned } = buildReconciliation(sap, entries || []);

    const totalMaterialSap = sap.length;
    const materialBelumDiinput = notYetScanned.length;
    const materialSudahDiinput = totalMaterialSap - materialBelumDiinput;
    const materialSelisih = rows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang').length;
    const totalQtyLebih = rows.filter((r) => r.selisih > 0).reduce((sum, r) => sum + r.selisih, 0);
    const totalQtyKurang = rows.filter((r) => r.selisih < 0).reduce((sum, r) => sum + Math.abs(r.selisih), 0);
    const progress = totalMaterialSap > 0 ? Math.round((materialSudahDiinput / totalMaterialSap) * 100) : 0;

    setStats({
      totalMaterialSap,
      materialSudahDiinput,
      materialBelumDiinput,
      materialSelisih,
      totalQtyLebih,
      totalQtyKurang,
      progress,
      hasSapData: sap.length > 0,
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
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{session.name}</h1>
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
            <StatCard label="Total Material SAP" value={stats.totalMaterialSap} />
            <StatCard label="Sudah Diinput" value={stats.materialSudahDiinput} tone="good" />
            <StatCard label="Belum Diinput" value={stats.materialBelumDiinput} tone="warn" />
            <StatCard label="Material Selisih" value={stats.materialSelisih} tone="bad" />
            <StatCard label="Total Qty Lebih" value={stats.totalQtyLebih} tone="warn" />
            <StatCard label="Total Qty Kurang" value={stats.totalQtyKurang} tone="bad" />
          </div>

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
