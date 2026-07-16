'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { buildReconciliation } from '../../../../lib/reconciliation';
import { fetchAll } from '../../../../lib/fetchAll';
import InfoTooltip from '../../../../components/InfoTooltip';

function fmt(n) {
  return Math.round(n || 0).toLocaleString('id-ID');
}

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
    const [{ data: sessionData }, sapData, entries] = await Promise.all([
      supabase.from('so_sessions').select('*').eq('id', id).single(),
      fetchAll(() => supabase.from('so_sap_data').select('*').eq('session_id', id)),
      fetchAll(() => supabase.from('so_entries').select('*').eq('session_id', id)),
    ]);

    setSession(sessionData);

    // Only materials with actual stock (Qty > 0) count toward "Total
    // Material" — rows with Qty 0 are still in SAP data for reference
    // but don't need a physical count.
    const sap = (sapData || []).filter((r) => Number(r.qty) > 0);
    const { rows, notYetScanned } = buildReconciliation(sap, entries || []);

    // Top-level Progress is deliberately item-count based (how many SAP
    // line-items have been touched at least once), NOT a Qty sum — Qty
    // in BOX can't be added to Qty in PC into one meaningful number.
    // Detailed Qty progress per unit lives in the cards/table below.
    const totalMaterialSap = sap.length;
    const materialBelumDiinput = notYetScanned.length;
    const materialSudahDiinput = totalMaterialSap - materialBelumDiinput;
    const progress = totalMaterialSap > 0 ? Math.round((materialSudahDiinput / totalMaterialSap) * 100) : 0;
    const notFoundCount = rows.filter((r) => r.status === 'Tidak Ada di SAP').length;

    // --- Per Base Unit of Measure breakdown ---
    // qtySap        = total target quantity per SAP (scanned + not yet)
    // qtyBelum      = SAP qty still sitting in un-scanned materials
    // qtySudah      = qtySap - qtyBelum  -> keeps Sudah + Belum = Total exactly
    // qtyInput      = actual qty_fisik entered by petugas (real counted amount)
    // qtyLebih/Kurang = true discrepancy for materials that HAVE been scanned
    const byUom = new Map();
    const getUom = (uom) => {
      const key = uom || '(tanpa satuan)';
      if (!byUom.has(key)) {
        byUom.set(key, { uom: key, qtySap: 0, qtyBelum: 0, qtyInput: 0, qtyLebih: 0, qtyKurang: 0 });
      }
      return byUom.get(key);
    };

    for (const r of sap) {
      getUom(r.base_uom).qtySap += Number(r.qty) || 0;
    }
    for (const r of notYetScanned) {
      getUom(r.base_uom).qtyBelum += Number(r.qty) || 0;
    }
    for (const r of rows) {
      const u = getUom(r.base_uom);
      if (r.selisih > 0) u.qtyLebih += r.selisih;
      else if (r.selisih < 0) u.qtyKurang += Math.abs(r.selisih);
    }
    for (const e of entries || []) {
      if (e.status_sap === 'tidak_ada_di_sap') continue; // tracked separately
      getUom(e.base_uom).qtyInput += Number(e.qty_fisik) || 0;
    }

    const qtyByUom = [...byUom.values()]
      .map((u) => {
        const qtySudah = Math.max(u.qtySap - u.qtyBelum, 0);
        const pctSudah = u.qtySap > 0 ? Math.round((qtySudah / u.qtySap) * 100) : 0;
        const pctBelum = u.qtySap > 0 ? Math.round((u.qtyBelum / u.qtySap) * 100) : 0;
        return {
          ...u,
          qtySudah,
          pctSudah,
          pctBelum,
          selisihNet: u.qtyLebih - u.qtyKurang,
          selisihAbs: u.qtyLebih + u.qtyKurang,
        };
      })
      .sort((a, b) => a.uom.localeCompare(b.uom));

    // Material-level list of discrepancies, biggest gap first, so
    // Accounting can see exactly which material needs attention without
    // having to open Rekonsiliasi first.
    const selisihPreview = rows
      .filter((r) => r.status === 'Lebih' || r.status === 'Kurang')
      .sort((a, b) => Math.abs(b.selisih) - Math.abs(a.selisih))
      .slice(0, 6);

    // Last activity + who's been active — only meaningful once input has
    // actually started, so both are null until then.
    let lastUpdate = null;
    const operatorSet = new Map(); // name -> last activity timestamp
    for (const e of entries || []) {
      const t = new Date(e.created_at);
      if (!lastUpdate || t > lastUpdate) lastUpdate = t;
      if (e.petugas_nama) {
        const prev = operatorSet.get(e.petugas_nama);
        if (!prev || t > prev) operatorSet.set(e.petugas_nama, t);
      }
    }
    const activeOperators = [...operatorSet.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    setStats({
      totalMaterialSap,
      materialSudahDiinput,
      materialBelumDiinput,
      progress,
      notFoundCount,
      qtyByUom,
      selisihPreview,
      lastUpdate,
      activeOperators,
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

  const totalSelisihAbs = stats?.qtyByUom.reduce((s, u) => s + u.selisihAbs, 0) || 0;

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

          {/* ============ PROGRESS — the single most important number ============ */}
          <div className="card p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                Progress Stock Opname
                <InfoTooltip text="Progress = jumlah item Material yang sudah diinput ÷ Total item Material di Data SAP. Dihitung per item, bukan Qty, supaya satuan BOX/PC/dll tidak tercampur." />
              </span>
              <span className="font-mono text-lg font-semibold text-ink">{stats.progress}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full transition-all ${stats.progress >= 100 ? 'bg-good' : 'bg-slate-850'}`}
                style={{ width: `${stats.progress}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink/50">
              <span>{fmt(stats.materialSudahDiinput)} / {fmt(stats.totalMaterialSap)} Material</span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Update terakhir:{' '}
                  <span className="font-medium text-ink/70">
                    {stats.lastUpdate
                      ? stats.lastUpdate.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                      : 'Belum ada input'}
                  </span>
                </span>
                <span>
                  Operator aktif:{' '}
                  <span className="font-medium text-ink/70">
                    {stats.activeOperators.length > 0 ? stats.activeOperators.join(', ') : '—'}
                  </span>
                </span>
              </span>
            </div>
          </div>

          {/* ============ SUDAH / BELUM / SELISIH / TIDAK ADA DI SAP ============ */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <UomPanel
              title="Sudah Diinput"
              tooltip="Qty target SAP milik material yang sudah discan minimal sekali, per satuan (Base Unit of Measure)."
              tone="good"
              rows={stats.qtyByUom.map((u) => ({
                uom: u.uom,
                line: `${fmt(u.qtySudah)} / ${fmt(u.qtySap)} (${u.pctSudah}%)`,
              }))}
            />
            <UomPanel
              title="Belum Diinput"
              tooltip="Qty target SAP milik material yang belum discan sama sekali. Angka ini berkurang otomatis tiap ada input baru."
              tone="warn"
              rows={stats.qtyByUom.map((u) => ({
                uom: u.uom,
                line: `${fmt(u.qtyBelum)} (${u.pctBelum}%)`,
              }))}
            />
            <UomPanel
              title="Material Selisih"
              tooltip="Total qty yang selisih antara Qty SAP dan Qty hasil stock opname (gabungan Lebih + Kurang), per satuan."
              tone={totalSelisihAbs > 0 ? 'bad' : 'neutral'}
              rows={stats.qtyByUom
                .filter((u) => u.selisihAbs > 0)
                .map((u) => ({
                  uom: u.uom,
                  line: `${fmt(u.selisihAbs)} (Lebih ${fmt(u.qtyLebih)} · Kurang ${fmt(u.qtyKurang)})`,
                }))}
              emptyText="Tidak ada selisih"
            />
            <Link
              href={`/admin/sessions/${id}/reconciliation?status=${encodeURIComponent('Tidak Ada di SAP')}`}
              className={`card block p-4 transition hover:shadow-md ${stats.notFoundCount > 0 ? 'hover:border-bad/40' : ''}`}
            >
              <div className="flex items-center gap-1.5 text-xs text-ink/50">
                Tidak Ada di SAP
                <InfoTooltip text="Jumlah material yang ditemukan saat stock opname tetapi tidak ada di master Data SAP. Klik untuk melihat daftar material tersebut." />
              </div>
              <div className={`mt-1 font-mono text-2xl font-semibold ${stats.notFoundCount > 0 ? 'text-bad' : 'text-ink/30'}`}>
                {stats.notFoundCount}
              </div>
              <div className="mt-1 text-xs font-medium text-slate-850">Klik untuk lihat daftar →</div>
            </Link>
          </div>

          {/* ============ RINGKASAN QTY ============ */}
          {stats.qtyByUom.length > 0 && (
            <div className="card p-5">
              <div className="mb-3 text-sm font-medium">Ringkasan Qty</div>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-ink/50">
                  <tr>
                    <th className="pb-2 pr-3">UoM</th>
                    <th className="pb-2 pr-3 text-right">Qty SAP</th>
                    <th className="pb-2 pr-3 text-right">Qty Input</th>
                    <th className="pb-2 pr-3 text-right">Selisih</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.qtyByUom.map((r) => (
                    <tr key={r.uom} className="border-t border-line">
                      <td className="py-2 pr-3 font-mono">{r.uom}</td>
                      <td className="py-2 pr-3 text-right font-mono">{fmt(r.qtySap)}</td>
                      <td className="py-2 pr-3 text-right font-mono">{fmt(r.qtyInput)}</td>
                      <td className={`py-2 pr-3 text-right font-mono ${r.selisihNet === 0 ? 'text-ink/40' : r.selisihNet > 0 ? 'text-warn' : 'text-bad'}`}>
                        {r.selisihNet > 0 ? '+' : ''}{fmt(r.selisihNet)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-ink/40">
                Qty Input = jumlah fisik yang benar-benar diinput petugas. Selisih = Qty Input − Qty SAP,
                dihitung dari material yang sudah discan saja.
              </p>
            </div>
          )}

          {stats.selisihPreview.length > 0 && (
            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium">Material dengan Selisih Terbesar</span>
                <Link href={`/admin/sessions/${id}/reconciliation`} className="text-xs font-medium text-slate-850 hover:underline">
                  Lihat semua →
                </Link>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-ink/50">
                  <tr>
                    <th className="pb-2 pr-3">Material</th>
                    <th className="pb-2 pr-3">Description</th>
                    <th className="pb-2 pr-3 text-right">Qty SAP</th>
                    <th className="pb-2 pr-3 text-right">Qty Fisik</th>
                    <th className="pb-2 pr-3 text-right">Selisih</th>
                    <th className="pb-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.selisihPreview.map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-2 pr-3 font-mono">{r.material}</td>
                      <td className="py-2 pr-3">{r.material_description}</td>
                      <td className="py-2 pr-3 text-right font-mono">{fmt(r.qty_sap)} {r.base_uom}</td>
                      <td className="py-2 pr-3 text-right font-mono">{fmt(r.total_qty_fisik)} {r.base_uom}</td>
                      <td className={`py-2 pr-3 text-right font-mono ${r.selisih > 0 ? 'text-warn' : 'text-bad'}`}>{r.selisih > 0 ? '+' : ''}{fmt(r.selisih)}</td>
                      <td className="py-2 pr-3">
                        <span className={`badge ${r.status === 'Lebih' ? 'bg-amber/20 text-warn' : 'bg-bad/10 text-bad'}`}>{r.status}</span>
                      </td>
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

// Small multi-row panel used for Sudah Diinput / Belum Diinput / Material
// Selisih — one card, one line per Base Unit of Measure, colored by tone.
function UomPanel({ title, tooltip, tone, rows, emptyText }) {
  const toneClass = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', neutral: 'text-ink/30' }[tone] || 'text-ink';
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-xs text-ink/50">
        {title}
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      {rows.length === 0 ? (
        <div className={`mt-1 text-sm ${toneClass}`}>{emptyText || '—'}</div>
      ) : (
        <div className="mt-1.5 space-y-1">
          {rows.map((r) => (
            <div key={r.uom} className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xs text-ink/50">{r.uom}</span>
              <span className={`font-mono text-sm font-semibold ${toneClass}`}>{r.line}</span>
            </div>
          ))}
        </div>
      )}
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
