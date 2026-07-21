'use client';

// Session Hub — now with 2 tabs: Normal SO and Rimpilan SO, sharing one
// session (so_sessions.id) and one recount lifecycle
// (active_recount_round / recount_material_codes), but with independent
// master data + entry tables and independent stat cards.
//
// NOTE for integration: this file is a drop-in replacement for
// app/admin/sessions/[id]/page.js. The Normal SO tab content below is
// the ORIGINAL dashboard, unchanged, just extracted into <NormalSoTab>.
// If you've customized this file since the version reviewed, re-apply
// your changes inside <NormalSoTab> — everything else (tab toggle,
// RimpilanSoTab, shared recount handlers) is new.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { buildReconciliation, buildRimpilanReconciliation } from '../../../../lib/reconciliation';
import { fetchAll } from '../../../../lib/fetchAll';
import InfoTooltip from '../../../../components/InfoTooltip';

function fmt(n) {
  return Math.round(n || 0).toLocaleString('id-ID');
}

export default function SessionHubPage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') === 'rimpilan' ? 'rimpilan' : 'normal');

  const [session, setSession] = useState(null);
  const [stats, setStats] = useState(null);           // normal SO stats
  const [rimpilanStats, setRimpilanStats] = useState(null); // rimpilan SO stats
  const [loading, setLoading] = useState(true);
  const [startingRecount, setStartingRecount] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  function switchTab(next) {
    setTab(next);
    router.replace(`/admin/sessions/${id}?tab=${next}`, { scroll: false });
  }

  async function load() {
    setLoading(true);
    const [{ data: sessionData }, sapData, entries, rimpilanSap, rimpilanEntries] = await Promise.all([
      supabase.from('so_sessions').select('*').eq('id', id).single(),
      fetchAll(() => supabase.from('so_sap_data').select('*').eq('session_id', id)),
      fetchAll(() => supabase.from('so_entries').select('*').eq('session_id', id)),
      fetchAll(() => supabase.from('rimpilan_sap_data').select('*').eq('session_id', id)),
      fetchAll(() => supabase.from('rimpilan_entries').select('*').eq('session_id', id)),
    ]);

    setSession(sessionData);
    setStats(computeNormalStats(sapData || [], entries || []));
    setRimpilanStats(computeRimpilanStats(rimpilanSap || [], rimpilanEntries || []));
    setLoading(false);
  }

  function computeNormalStats(sapDataRaw, entries) {
    const sap = sapDataRaw.filter((r) => Number(r.qty) > 0);
    const { rows, notYetScanned } = buildReconciliation(sap, entries);

    const totalMaterialSap = sap.length;
    const materialBelumDiinput = notYetScanned.length;
    const materialSudahDiinput = totalMaterialSap - materialBelumDiinput;
    const progress = totalMaterialSap > 0 ? Math.round((materialSudahDiinput / totalMaterialSap) * 100) : 0;
    const notFoundCount = rows.filter((r) => r.status === 'Tidak Ada di SAP').length;

    const byUom = new Map();
    const getUom = (uom) => {
      const key = uom || '(tanpa satuan)';
      if (!byUom.has(key)) byUom.set(key, { uom: key, qtySap: 0, qtyBelum: 0, qtyInput: 0, qtyLebih: 0, qtyKurang: 0 });
      return byUom.get(key);
    };
    for (const r of sap) getUom(r.base_uom).qtySap += Number(r.qty) || 0;
    for (const r of notYetScanned) getUom(r.base_uom).qtyBelum += Number(r.qty) || 0;
    for (const r of rows) {
      const u = getUom(r.base_uom);
      if (r.selisih > 0) u.qtyLebih += r.selisih;
      else if (r.selisih < 0) u.qtyKurang += Math.abs(r.selisih);
    }
    for (const r of rows) {
      if (r.status === 'Tidak Ada di SAP') continue;
      getUom(r.base_uom).qtyInput += r.total_qty_fisik;
    }
    const qtyByUom = [...byUom.values()]
      .map((u) => {
        const qtySudah = Math.max(u.qtySap - u.qtyBelum, 0);
        return {
          ...u,
          qtySudah,
          pctSudah: u.qtySap > 0 ? Math.round((qtySudah / u.qtySap) * 100) : 0,
          pctBelum: u.qtySap > 0 ? Math.round((u.qtyBelum / u.qtySap) * 100) : 0,
          selisihNet: u.qtyLebih - u.qtyKurang,
          selisihAbs: u.qtyLebih + u.qtyKurang,
        };
      })
      .sort((a, b) => a.uom.localeCompare(b.uom));

    const selisihRows = rows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang');
    const selisihPreview = [...selisihRows].sort((a, b) => Math.abs(b.selisih) - Math.abs(a.selisih)).slice(0, 6);

    let lastUpdate = null;
    const operatorSet = new Map();
    for (const e of entries) {
      const t = new Date(e.created_at);
      if (!lastUpdate || t > lastUpdate) lastUpdate = t;
      if (e.petugas_nama) {
        const prev = operatorSet.get(e.petugas_nama);
        if (!prev || t > prev) operatorSet.set(e.petugas_nama, t);
      }
    }
    const activeOperators = [...operatorSet.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const recountedCount = rows.filter((r) => r.wasRecounted).length;

    return {
      totalMaterialSap, materialSudahDiinput, materialBelumDiinput, progress, notFoundCount,
      qtyByUom, selisihPreview, selisihMaterialCodes: selisihRows.map((r) => r.material),
      recountedCount, lastUpdate, activeOperators, hasSapData: sapDataRaw.length > 0,
    };
  }

  // Mirrors computeNormalStats, sourced from rimpilan_sap_data /
  // rimpilan_entries instead. "Sudah/Belum Diinput" here means "material
  // rimpilan sudah/belum ada minimal 1 entry (normal qty atau keterangan)".
  function computeRimpilanStats(rimpilanSapRaw, entries) {
    const { rows, notYetScanned } = buildRimpilanReconciliation(rimpilanSapRaw, entries);

    const totalMaterialSap = rimpilanSapRaw.length;
    const materialBelumDiinput = notYetScanned.length;
    const materialSudahDiinput = totalMaterialSap - materialBelumDiinput;
    const progress = totalMaterialSap > 0 ? Math.round((materialSudahDiinput / totalMaterialSap) * 100) : 0;

    const byUom = new Map();
    const getUom = (uom) => {
      const key = uom || '(tanpa satuan)';
      if (!byUom.has(key)) byUom.set(key, { uom: key, qtySap: 0, qtyBelum: 0, qtyInput: 0, qtyLebih: 0, qtyKurang: 0 });
      return byUom.get(key);
    };
    for (const r of rimpilanSapRaw) getUom(r.base_uom).qtySap += Number(r.qty) || 0;
    for (const r of notYetScanned) getUom(r.base_uom).qtyBelum += Number(r.qty) || 0;
    for (const r of rows) {
      const u = getUom(r.base_uom);
      if (r.selisih > 0) u.qtyLebih += r.selisih;
      else if (r.selisih < 0) u.qtyKurang += Math.abs(r.selisih);
      u.qtyInput += r.total_qty_fisik;
    }
    const qtyByUom = [...byUom.values()]
      .map((u) => ({
        ...u,
        qtySudah: Math.max(u.qtySap - u.qtyBelum, 0),
        pctSudah: u.qtySap > 0 ? Math.round((Math.max(u.qtySap - u.qtyBelum, 0) / u.qtySap) * 100) : 0,
        selisihNet: u.qtyLebih - u.qtyKurang,
        selisihAbs: u.qtyLebih + u.qtyKurang,
      }))
      .sort((a, b) => a.uom.localeCompare(b.uom));

    const selisihRows = rows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang');
    const selisihPreview = [...selisihRows].sort((a, b) => Math.abs(b.selisih) - Math.abs(a.selisih)).slice(0, 6);

    let lastUpdate = null;
    const operatorSet = new Map();
    // rak/keterangan breakdown, unique to rimpilan
    const keteranganCount = new Map();
    for (const e of entries) {
      const t = new Date(e.created_at);
      if (!lastUpdate || t > lastUpdate) lastUpdate = t;
      if (e.petugas_nama) {
        const prev = operatorSet.get(e.petugas_nama);
        if (!prev || t > prev) operatorSet.set(e.petugas_nama, t);
      }
      if (e.keterangan_khusus) {
        keteranganCount.set(e.keterangan_khusus, (keteranganCount.get(e.keterangan_khusus) || 0) + 1);
      }
    }
    const activeOperators = [...operatorSet.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const recountedCount = rows.filter((r) => r.wasRecounted).length;

    return {
      totalMaterialSap, materialSudahDiinput, materialBelumDiinput, progress,
      qtyByUom, selisihPreview, selisihMaterialCodes: selisihRows.map((r) => r.material),
      recountedCount, lastUpdate, activeOperators, hasMasterData: rimpilanSapRaw.length > 0,
      keteranganBreakdown: [...keteranganCount.entries()],
    };
  }

  async function handleCloseSession() {
    if (!confirm('Tutup session ini? Session yang ditutup masih bisa dilihat di History.')) return;
    await supabase.from('so_sessions').update({ status: 'closed' }).eq('id', id);
    load();
  }

  // Recount now covers BOTH workflows: union of selisih material codes
  // from Normal SO + Rimpilan SO. Petugas di kedua halaman input
  // (normal & rimpilan) sama-sama dibatasi ke daftar ini via
  // so_sessions.recount_material_codes yang shared.
  async function handleStartRecount() {
    const normalCodes = stats?.selisihMaterialCodes || [];
    const rimpilanCodes = rimpilanStats?.selisihMaterialCodes || [];
    const materials = [...new Set([...normalCodes, ...rimpilanCodes])];
    if (materials.length === 0) {
      alert('Tidak ada material dengan selisih saat ini (Normal maupun Rimpilan).');
      return;
    }
    const nextRound = (session.active_recount_round || 0) + 1;
    const confirmMsg = `Mulai Recount Round ${nextRound} untuk ${materials.length} material yang selisih (Normal: ${normalCodes.length}, Rimpilan: ${rimpilanCodes.length})?\n\nPetugas hanya bisa input material ini sampai recount selesai, di kedua halaman input.`;
    if (!confirm(confirmMsg)) return;

    setStartingRecount(true);
    const { error } = await supabase
      .from('so_sessions')
      .update({ active_recount_round: nextRound, recount_material_codes: materials })
      .eq('id', id);

    if (!error) {
      await supabase.from('so_recount_rounds').insert({
        session_id: id,
        round_number: nextRound,
        material_codes: materials,
      });
    }

    setStartingRecount(false);
    if (error) {
      alert('Gagal memulai recount: ' + error.message);
      return;
    }
    load();
  }

  async function handleStopRecount() {
    if (!confirm('Selesaikan mode recount? Petugas kembali bisa input semua material seperti biasa (Normal & Rimpilan).')) return;
    await supabase.from('so_sessions').update({ recount_material_codes: [] }).eq('id', id);
    load();
  }

  if (loading) return <div className="text-sm text-ink/50">Memuat session...</div>;
  if (!session) return <div className="text-sm text-bad">Session tidak ditemukan.</div>;

  const recountActive = (session.recount_material_codes || []).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/admin" className="text-xs text-ink/50 hover:text-ink">← Semua Session</Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{session.name}</h1>
            {session.plant && <span className="badge bg-slate-850/10 text-ink">{session.plant}</span>}
            {session.active_recount_round > 0 && (
              <span className="badge bg-amber/20 text-warn">Recount Round {session.active_recount_round}</span>
            )}
          </div>
        </div>
        {session.status === 'active' && (
          <button onClick={handleCloseSession} className="btn-ghost text-xs">Tutup Session</button>
        )}
      </div>

      <div className="flex gap-1 border-b border-line">
        <button
          onClick={() => switchTab('normal')}
          className={`px-4 py-2 text-sm font-medium ${tab === 'normal' ? 'border-b-2 border-slate-850 text-ink' : 'text-ink/50 hover:text-ink'}`}
        >
          Normal SO
        </button>
        <button
          onClick={() => switchTab('rimpilan')}
          className={`px-4 py-2 text-sm font-medium ${tab === 'rimpilan' ? 'border-b-2 border-slate-850 text-ink' : 'text-ink/50 hover:text-ink'}`}
        >
          Rimpilan SO
          {rimpilanStats?.selisihMaterialCodes?.length > 0 && (
            <span className="badge ml-1.5 bg-bad/10 text-bad">{rimpilanStats.selisihMaterialCodes.length}</span>
          )}
        </button>
      </div>

      {tab === 'normal' ? (
        <NormalSoTab
          id={id}
          session={session}
          stats={stats}
          recountActive={recountActive}
          startingRecount={startingRecount}
          onStartRecount={handleStartRecount}
          onStopRecount={handleStopRecount}
        />
      ) : (
        <RimpilanSoTab
          id={id}
          session={session}
          stats={rimpilanStats}
          recountActive={recountActive}
          startingRecount={startingRecount}
          onStartRecount={handleStartRecount}
          onStopRecount={handleStopRecount}
        />
      )}
    </div>
  );
}

// ============ NORMAL SO TAB — original dashboard content, unchanged ============
function NormalSoTab({ id, session, stats, recountActive, startingRecount, onStartRecount, onStopRecount }) {
  const totalSelisihAbs = stats?.qtyByUom.reduce((s, u) => s + u.selisihAbs, 0) || 0;

  if (!stats.hasSapData) {
    return (
      <div className="card border-amber/40 bg-amber/10 p-5">
        <div className="font-medium">Belum ada Data SAP</div>
        <p className="mt-1 text-sm text-ink/60">Upload Data SAP terlebih dahulu sebelum memulai Stock Opname.</p>
        <Link href={`/admin/sessions/${id}/upload`} className="btn-primary mt-4 inline-flex">Upload Data SAP</Link>
      </div>
    );
  }

  return (
    <>
      {stats.notFoundCount > 0 && (
        <Link
          href={`/admin/sessions/${id}/reconciliation?status=${encodeURIComponent('Tidak Ada di SAP')}`}
          className="card flex items-center justify-between border-bad/30 bg-bad/5 p-4 transition hover:shadow-md"
        >
          <div className="flex items-center gap-2 text-sm text-bad">
            <BellDotIcon />
            <span><strong className="font-semibold">{stats.notFoundCount} material</strong> discan tapi tidak ditemukan di Data SAP.</span>
          </div>
          <span className="text-xs font-medium text-bad">Lihat →</span>
        </Link>
      )}

      {recountActive ? (
        <div className="card flex items-center justify-between border-warn/40 bg-warn/10 p-4">
          <div className="text-sm">
            <div className="font-medium text-warn">🔄 Recount Round {session.active_recount_round} sedang berjalan</div>
            <p className="mt-1 text-ink/60">
              {(session.recount_material_codes || []).length} material dikunci untuk di-input ulang (Normal + Rimpilan).
            </p>
          </div>
          <button onClick={onStopRecount} className="btn-ghost shrink-0 text-xs">Selesaikan Recount</button>
        </div>
      ) : (
        stats.selisihPreview.length > 0 && (
          <div className="card flex items-center justify-between border-warn/30 bg-warn/5 p-4">
            <div className="text-sm">
              <div className="font-medium text-warn">{stats.selisihMaterialCodes.length} material ada selisih</div>
              <p className="mt-1 text-ink/60">Minta petugas recount hanya material yang selisih ini.</p>
            </div>
            <button onClick={onStartRecount} disabled={startingRecount} className="btn-amber shrink-0 text-xs disabled:opacity-60">
              {startingRecount ? 'Memulai...' : 'Mulai Recount'}
            </button>
          </div>
        )
      )}

      <div className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Progress Stock Opname
            <InfoTooltip text="Progress = jumlah item Material yang sudah diinput ÷ Total item Material di Data SAP." />
          </span>
          <span className="font-mono text-lg font-semibold text-ink">{stats.progress}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
          <div className={`h-full rounded-full transition-all ${stats.progress >= 100 ? 'bg-good' : 'bg-slate-850'}`} style={{ width: `${stats.progress}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink/50">
          <span>{fmt(stats.materialSudahDiinput)} / {fmt(stats.totalMaterialSap)} Material</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Update terakhir: <span className="font-medium text-ink/70">{stats.lastUpdate ? stats.lastUpdate.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Belum ada input'}</span></span>
            <span>Operator aktif: <span className="font-medium text-ink/70">{stats.activeOperators.length > 0 ? stats.activeOperators.join(', ') : '—'}</span></span>
            {stats.recountedCount > 0 && <span>Sudah di-recount: <span className="font-medium text-warn">{stats.recountedCount} material</span></span>}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UomPanel title="Sudah Diinput" tone="good" rows={stats.qtyByUom.map((u) => ({ uom: u.uom, line: `${fmt(u.qtySudah)} / ${fmt(u.qtySap)} (${u.pctSudah}%)` }))} />
        <UomPanel title="Belum Diinput" tone="warn" rows={stats.qtyByUom.map((u) => ({ uom: u.uom, line: `${fmt(u.qtyBelum)} (${u.pctBelum}%)` }))} />
        <UomPanel
          title="Material Selisih"
          tone={totalSelisihAbs > 0 ? 'bad' : 'neutral'}
          rows={stats.qtyByUom.filter((u) => u.selisihAbs > 0).map((u) => ({ uom: u.uom, line: `${fmt(u.selisihAbs)} (Lebih ${fmt(u.qtyLebih)} · Kurang ${fmt(u.qtyKurang)})` }))}
          emptyText="Tidak ada selisih"
        />
        <Link href={`/admin/sessions/${id}/reconciliation?status=${encodeURIComponent('Tidak Ada di SAP')}`} className={`card block p-4 transition hover:shadow-md ${stats.notFoundCount > 0 ? 'hover:border-bad/40' : ''}`}>
          <div className="flex items-center gap-1.5 text-xs text-ink/50">Tidak Ada di SAP</div>
          <div className={`mt-1 font-mono text-2xl font-semibold ${stats.notFoundCount > 0 ? 'text-bad' : 'text-ink/30'}`}>{stats.notFoundCount}</div>
          <div className="mt-1 text-xs font-medium text-slate-850">Klik untuk lihat daftar →</div>
        </Link>
      </div>

      {stats.selisihPreview.length > 0 && (
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">Material dengan Selisih Terbesar</span>
            <Link href={`/admin/sessions/${id}/reconciliation`} className="text-xs font-medium text-slate-850 hover:underline">Lihat semua →</Link>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink/50">
              <tr><th className="pb-2 pr-3">Material</th><th className="pb-2 pr-3">Description</th><th className="pb-2 pr-3 text-right">Qty SAP</th><th className="pb-2 pr-3 text-right">Qty Fisik</th><th className="pb-2 pr-3 text-right">Selisih</th><th className="pb-2 pr-3">Status</th></tr>
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
                    {r.wasRecounted && <span className="badge ml-1 bg-slate-850/10 text-ink/60">recount {r.recountRound}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <ActionLink href={`/admin/sessions/${id}/reconciliation`} title="Rekonsiliasi" desc="Bandingkan hasil hitung dengan Data SAP" />
        <ActionLink href={`/admin/sessions/${id}/upload`} title="Upload Data SAP" desc="Tambah atau perbarui Data SAP session ini" />
        <ExportAction sessionId={id} sessionName={session.name} />
      </div>
    </>
  );
}

// ============ RIMPILAN SO TAB — new, mirrors Normal SO layout ============
function RimpilanSoTab({ id, session, stats, recountActive, startingRecount, onStartRecount, onStopRecount }) {
  if (!stats.hasMasterData) {
    return (
      <div className="card border-amber/40 bg-amber/10 p-5">
        <div className="font-medium">Belum ada Master Rimpilan</div>
        <p className="mt-1 text-sm text-ink/60">Upload Master Rimpilan dan Warehouse Racks terlebih dahulu.</p>
        <div className="mt-4 flex gap-2">
          <Link href={`/admin/sessions/${id}/upload/rimpilan`} className="btn-primary inline-flex">Upload Master Rimpilan</Link>
          <Link href={`/admin/sessions/${id}/upload/racks`} className="btn-ghost inline-flex">Upload Warehouse Racks</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {recountActive ? (
        <div className="card flex items-center justify-between border-warn/40 bg-warn/10 p-4">
          <div className="text-sm">
            <div className="font-medium text-warn">🔄 Recount Round {session.active_recount_round} sedang berjalan</div>
            <p className="mt-1 text-ink/60">Rak dengan material selisih otomatis tersembunyi dari halaman Input Rimpilan sampai selesai.</p>
          </div>
          <button onClick={onStopRecount} className="btn-ghost shrink-0 text-xs">Selesaikan Recount</button>
        </div>
      ) : (
        stats.selisihPreview.length > 0 && (
          <div className="card flex items-center justify-between border-warn/30 bg-warn/5 p-4">
            <div className="text-sm">
              <div className="font-medium text-warn">{stats.selisihMaterialCodes.length} material rimpilan ada selisih</div>
              <p className="mt-1 text-ink/60">Assign petugas ke rak yang selisih untuk recount.</p>
            </div>
            <button onClick={onStartRecount} disabled={startingRecount} className="btn-amber shrink-0 text-xs disabled:opacity-60">
              {startingRecount ? 'Memulai...' : 'Mulai Recount'}
            </button>
          </div>
        )
      )}

      <div className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Progress Rimpilan SO</span>
          <span className="font-mono text-lg font-semibold text-ink">{stats.progress}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
          <div className={`h-full rounded-full transition-all ${stats.progress >= 100 ? 'bg-good' : 'bg-slate-850'}`} style={{ width: `${stats.progress}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink/50">
          <span>{fmt(stats.materialSudahDiinput)} / {fmt(stats.totalMaterialSap)} Material</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Update terakhir: <span className="font-medium text-ink/70">{stats.lastUpdate ? stats.lastUpdate.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Belum ada input'}</span></span>
            <span>Operator aktif: <span className="font-medium text-ink/70">{stats.activeOperators.length > 0 ? stats.activeOperators.join(', ') : '—'}</span></span>
            {stats.recountedCount > 0 && <span>Sudah di-recount: <span className="font-medium text-warn">{stats.recountedCount} material</span></span>}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <UomPanel title="Sudah Diinput" tone="good" rows={stats.qtyByUom.map((u) => ({ uom: u.uom, line: `${fmt(u.qtySudah)} / ${fmt(u.qtySap)} (${u.pctSudah}%)` }))} />
        <UomPanel title="Belum Diinput" tone="warn" rows={stats.qtyByUom.map((u) => ({ uom: u.uom, line: `${fmt(u.qtyBelum)}` }))} />
        <UomPanel
          title="Selisih"
          tone={stats.selisihMaterialCodes.length > 0 ? 'bad' : 'neutral'}
          rows={stats.qtyByUom.filter((u) => u.selisihAbs > 0).map((u) => ({ uom: u.uom, line: `${fmt(u.selisihAbs)} (Lebih ${fmt(u.qtyLebih)} · Kurang ${fmt(u.qtyKurang)})` }))}
          emptyText="Tidak ada selisih"
        />
      </div>

      {stats.keteranganBreakdown.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-medium">Keterangan Khusus Ditemukan</div>
          <div className="flex flex-wrap gap-2">
            {stats.keteranganBreakdown.map(([k, count]) => (
              <span key={k} className="badge bg-warn/10 text-warn">{k}: {count}</span>
            ))}
          </div>
        </div>
      )}

      {stats.selisihPreview.length > 0 && (
        <div className="card p-5">
          <div className="mb-3 text-sm font-medium">Material Rimpilan dengan Selisih Terbesar</div>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink/50">
              <tr><th className="pb-2 pr-3">Material</th><th className="pb-2 pr-3">Description</th><th className="pb-2 pr-3 text-right">Qty SAP</th><th className="pb-2 pr-3 text-right">Qty Fisik</th><th className="pb-2 pr-3 text-right">Selisih</th><th className="pb-2 pr-3">Status</th></tr>
            </thead>
            <tbody>
              {stats.selisihPreview.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-2 pr-3 font-mono">{r.material}</td>
                  <td className="py-2 pr-3">{r.material_description}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(r.qty_sap)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(r.total_qty_fisik)}</td>
                  <td className={`py-2 pr-3 text-right font-mono ${r.selisih > 0 ? 'text-warn' : 'text-bad'}`}>{r.selisih > 0 ? '+' : ''}{fmt(r.selisih)}</td>
                  <td className="py-2 pr-3">
                    <span className={`badge ${r.status === 'Lebih' ? 'bg-amber/20 text-warn' : 'bg-bad/10 text-bad'}`}>{r.status}</span>
                    {r.wasRecounted && <span className="badge ml-1 bg-slate-850/10 text-ink/60">recount {r.recountRound}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <ActionLink href={`/admin/sessions/${id}/upload/rimpilan`} title="Upload Master Rimpilan" desc="Tambah atau perbarui Master Rimpilan" />
        <ActionLink href={`/admin/sessions/${id}/upload/racks`} title="Upload Warehouse Racks" desc="Kelola mapping warehouse → rak" />
      </div>
    </>
  );
}

function UomPanel({ title, tooltip, tone, rows, emptyText }) {
  const toneClass = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', neutral: 'text-ink/30' }[tone] || 'text-ink';
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-xs text-ink/50">{title}{tooltip && <InfoTooltip text={tooltip} />}</div>
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
