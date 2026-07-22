'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { buildReconciliation, buildRimpilanReconciliation, buildCombinedReconciliation } from '../../../../lib/reconciliation';
import { fetchAll } from '../../../../lib/fetchAll';
import InfoTooltip from '../../../../components/InfoTooltip';

function fmt(n) {
  return Math.round(n || 0).toLocaleString('id-ID');
}

export default function SessionHubPage() {
  const { id } = useParams();
  const [session, setSession] = useState(null);
  const [stats, setStats] = useState(null);
  const [rimpilanStats, setRimpilanStats] = useState(null);
  const [recountCandidates, setRecountCandidates] = useState([]); // [{code, source}] from combined reconciliation
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('normal'); // 'normal' | 'rimpilan'
  const [startingRecount, setStartingRecount] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const [{ data: sessionData }, sapData, entries, rimpilanSapData, rimpilanEntries] = await Promise.all([
      supabase.from('so_sessions').select('*').eq('id', id).single(),
      fetchAll(() => supabase.from('so_sap_data').select('*').eq('session_id', id)),
      fetchAll(() => supabase.from('so_entries').select('*').eq('session_id', id)),
      fetchAll(() => supabase.from('rimpilan_sap_data').select('*').eq('session_id', id)),
      fetchAll(() => supabase.from('rimpilan_entries').select('*').eq('session_id', id)),
    ]);

    setSession(sessionData);

    // ============ Tab 1: Normal SO (unchanged baseline behavior) ============
    // Only materials with actual stock (Qty > 0) count toward "Total
    // Material" — rows with Qty 0 are still in SAP data for reference
    // but don't need a physical count.
    const sap = (sapData || []).filter((r) => Number(r.qty) > 0);
    const { rows, notYetScanned } = buildReconciliation(sap, entries || []);

    const totalMaterialSap = sap.length;
    const materialBelumDiinput = notYetScanned.length;
    const materialSudahDiinput = totalMaterialSap - materialBelumDiinput;
    const progress = totalMaterialSap > 0 ? Math.round((materialSudahDiinput / totalMaterialSap) * 100) : 0;
    const notFoundCount = rows.filter((r) => r.status === 'Tidak Ada di SAP').length;

    const byUom = new Map();
    const getUom = (map, uom) => {
      const key = uom || '(tanpa satuan)';
      if (!map.has(key)) {
        map.set(key, { uom: key, qtySap: 0, qtyBelum: 0, qtyInput: 0, qtyLebih: 0, qtyKurang: 0 });
      }
      return map.get(key);
    };

    for (const r of sap) getUom(byUom, r.base_uom).qtySap += Number(r.qty) || 0;
    for (const r of notYetScanned) getUom(byUom, r.base_uom).qtyBelum += Number(r.qty) || 0;
    for (const r of rows) {
      if (r.status === 'Tidak Ada di SAP') continue;
      const u = getUom(byUom, r.base_uom);
      if (r.selisih > 0) u.qtyLebih += r.selisih;
      else if (r.selisih < 0) u.qtyKurang += Math.abs(r.selisih);
    }
    for (const r of rows) {
      if (r.status === 'Tidak Ada di SAP') continue;
      getUom(byUom, r.base_uom).qtyInput += r.total_qty_fisik;
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

    const selisihPreview = rows
      .filter((r) => r.status === 'Lebih' || r.status === 'Kurang')
      .sort((a, b) => Math.abs(b.selisih) - Math.abs(a.selisih))
      .slice(0, 6);

    let lastUpdate = null;
    for (const e of entries || []) {
      const t = new Date(e.created_at);
      if (!lastUpdate || t > lastUpdate) lastUpdate = t;
    }
    const recountedCount = rows.filter((r) => r.wasRecounted).length;

    setStats({
      totalMaterialSap,
      materialSudahDiinput,
      materialBelumDiinput,
      progress,
      notFoundCount,
      qtyByUom,
      selisihPreview,
      recountedCount,
      lastUpdate,
      hasSapData: (sapData || []).length > 0,
    });

    // ============ Tab 2: Rimpilan SO ============
    // Its own progress cards, scoped to rimpilan_sap_data / rimpilan_entries
    // — a separate universe of materials from Normal SO's so_sap_data.
    const rimpilanResult = buildRimpilanReconciliation(rimpilanSapData || [], rimpilanEntries || []);
    const totalMaterialRimpilan = (rimpilanSapData || []).length;
    const rimpilanBelum = rimpilanResult.notYetScanned.length;
    const rimpilanSudah = totalMaterialRimpilan - rimpilanBelum;
    const rimpilanProgress = totalMaterialRimpilan > 0 ? Math.round((rimpilanSudah / totalMaterialRimpilan) * 100) : 0;
    const rimpilanSelisih = rimpilanResult.rows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang');
    const rimpilanSelisihPreview = [...rimpilanSelisih]
      .sort((a, b) => Math.abs(b.selisih) - Math.abs(a.selisih))
      .slice(0, 6);
    const raksTouched = new Set((rimpilanEntries || []).map((e) => e.nomor_rak)).size;
    const totalRaks = new Set((rimpilanSapData || []).map((r) => r.nomor_rak)).size;

    setRimpilanStats({
      totalMaterialRimpilan,
      rimpilanSudah,
      rimpilanBelum,
      rimpilanProgress,
      rimpilanSelisihCount: rimpilanSelisih.length,
      rimpilanSelisihPreview,
      raksTouched,
      totalRaks,
      hasRimpilanData: (rimpilanSapData || []).length > 0,
    });

    // ============ Combined selisih (drives the recount button) ============
    // The "true" list: material codes where SAP qty doesn't match Normal +
    // Rimpilan qty combined. Each code is tagged with which page(s) a
    // petugas needs to open to recount it.
    const combined = buildCombinedReconciliation(sap, entries || [], rimpilanEntries || []);
    const combinedSelisihRows = combined.rows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang');
    const candidates = combinedSelisihRows.map((r) => {
      const hasNormal = r.entries.some((e) => e.__source !== 'rimpilan');
      const hasRimpilan = r.entries.some((e) => e.__source === 'rimpilan');
      const source = hasNormal && hasRimpilan ? 'both' : hasRimpilan ? 'rimpilan' : 'normal';
      return { code: r.material, source };
    });
    setRecountCandidates(candidates);

    setLoading(false);
  }

  async function handleCloseSession() {
    if (!confirm('Tutup session ini? Session yang ditutup masih bisa dilihat di History.')) return;
    await supabase.from('so_sessions').update({ status: 'closed' }).eq('id', id);
    load();
  }

  // Accounting menekan ini setelah lihat ada selisih. Semua material yang
  // statusnya Lebih/Kurang saat ini (gabungan Normal + Rimpilan) dikunci
  // sebagai daftar yang boleh di-recount, masing-masing ditandai harus
  // di-recount lewat halaman Normal, Rimpilan, atau keduanya. Petugas di
  // halaman Input hanya bisa memilih material dari daftar ini selama
  // round recount ini masih aktif — dan kedua halaman input berbagi
  // round counter yang sama (so_sessions.active_recount_round).
  async function handleStartRecount() {
    if (recountCandidates.length === 0) {
      alert('Tidak ada material dengan selisih saat ini.');
      return;
    }
    const nextRound = (session.active_recount_round || 0) + 1;
    const confirmMsg = `Mulai Recount Round ${nextRound} untuk ${recountCandidates.length} material yang selisih (Normal + Rimpilan)?\n\nPetugas hanya bisa input material ini sampai recount selesai.`;
    if (!confirm(confirmMsg)) return;

    setStartingRecount(true);
    const { error } = await supabase
      .from('so_sessions')
      .update({
        active_recount_round: nextRound,
        recount_material_codes: recountCandidates,
      })
      .eq('id', id);

    if (!error) {
      await supabase.from('so_recount_rounds').insert({
        session_id: id,
        round_number: nextRound,
        material_codes: recountCandidates,
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
    if (!confirm('Selesaikan mode recount? Petugas kembali bisa input semua material seperti biasa.')) return;
    await supabase.from('so_sessions').update({ recount_material_codes: [] }).eq('id', id);
    load();
  }

  if (loading) return <div className="text-sm text-ink/50">Memuat session...</div>;
  if (!session) return <div className="text-sm text-bad">Session tidak ditemukan.</div>;

  const totalSelisihAbs = stats?.qtyByUom.reduce((s, u) => s + u.selisihAbs, 0) || 0;
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

      {/* ============ Recount banner — spans both tabs, combined count ============ */}
      {stats.hasSapData && (
        recountActive ? (
          <div className="card flex items-center justify-between border-warn/40 bg-warn/10 p-4">
            <div className="text-sm">
              <div className="font-medium text-warn">🔄 Recount Round {session.active_recount_round} sedang berjalan</div>
              <div className="mt-0.5 text-ink/60">
                {(session.recount_material_codes || []).length} material dikunci untuk di-recount (Normal + Rimpilan).
              </div>
            </div>
            <button onClick={handleStopRecount} className="btn-ghost text-xs shrink-0">Selesaikan Recount</button>
          </div>
        ) : recountCandidates.length > 0 ? (
          <div className="card flex items-center justify-between border-bad/30 bg-bad/5 p-4">
            <div className="text-sm">
              <div className="font-medium text-bad">{recountCandidates.length} material selisih (Normal + Rimpilan)</div>
              <div className="mt-0.5 text-ink/60">Mulai recount untuk mengunci petugas hanya menghitung ulang material ini.</div>
            </div>
            <button onClick={handleStartRecount} disabled={startingRecount} className="btn-primary text-xs shrink-0">
              {startingRecount ? 'Memulai...' : 'Mulai Recount'}
            </button>
          </div>
        ) : null
      )}

      {/* ============ Tab toggle ============ */}
      {stats.hasSapData && (
        <div className="inline-flex rounded-lg border border-line bg-white p-1">
          <button
            onClick={() => setActiveTab('normal')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${activeTab === 'normal' ? 'bg-slate-850 text-white' : 'text-ink/60 hover:text-ink'}`}
          >
            Normal SO
          </button>
          <button
            onClick={() => setActiveTab('rimpilan')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${activeTab === 'rimpilan' ? 'bg-slate-850 text-white' : 'text-ink/60 hover:text-ink'}`}
          >
            Rimpilan SO
          </button>
        </div>
      )}

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
      ) : activeTab === 'normal' ? (
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
                {stats.recountedCount > 0 && (
                  <span>
                    Sudah di-recount:{' '}
                    <span className="font-medium text-warn">{stats.recountedCount} material</span>
                  </span>
                )}
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
              tooltip="Total qty yang selisih antara Qty SAP dan Qty hasil stock opname (gabungan Lebih + Kurang), per satuan. Kalau material sudah di-recount, angka ini pakai hasil recount terakhir."
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
                Qty Input = jumlah fisik yang benar-benar diinput petugas (khusus Normal SO). Untuk angka
                Selisih gabungan dengan Rimpilan, lihat Rekonsiliasi atau Export Excel.
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
                        {r.wasRecounted && (
                          <span className="badge ml-1 bg-slate-850/10 text-ink/60">recount {r.recountRound}</span>
                        )}
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
      ) : (
        <>
          {!rimpilanStats.hasRimpilanData ? (
            <div className="card border-amber/40 bg-amber/10 p-5">
              <div className="font-medium">Belum ada Data Master Rimpilan</div>
              <p className="mt-1 text-sm text-ink/60">
                Upload Data Master Rimpilan (material + rak + level) terlebih dahulu.
              </p>
              <Link href={`/admin/sessions/${id}/upload/rimpilan`} className="btn-primary mt-4 inline-flex">
                Upload Data Rimpilan
              </Link>
            </div>
          ) : (
            <>
              <div className="card p-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    Progress Rimpilan SO
                    <InfoTooltip text="Progress = jumlah item Material Rimpilan yang sudah diinput (qty normal, bukan keterangan khusus) ÷ Total item di Data Master Rimpilan." />
                  </span>
                  <span className="font-mono text-lg font-semibold text-ink">{rimpilanStats.rimpilanProgress}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full rounded-full transition-all ${rimpilanStats.rimpilanProgress >= 100 ? 'bg-good' : 'bg-slate-850'}`}
                    style={{ width: `${rimpilanStats.rimpilanProgress}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink/50">
                  <span>{fmt(rimpilanStats.rimpilanSudah)} / {fmt(rimpilanStats.totalMaterialRimpilan)} Material</span>
                  <span>{rimpilanStats.raksTouched} / {rimpilanStats.totalRaks} Rak sudah disentuh</span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="card p-4">
                  <div className="text-xs text-ink/50">Material Sudah Diinput</div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-good">{fmt(rimpilanStats.rimpilanSudah)}</div>
                </div>
                <div className="card p-4">
                  <div className="text-xs text-ink/50">Material Belum Diinput</div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-warn">{fmt(rimpilanStats.rimpilanBelum)}</div>
                </div>
                <div className="card p-4">
                  <div className="text-xs text-ink/50">Material Selisih</div>
                  <div className={`mt-1 font-mono text-2xl font-semibold ${rimpilanStats.rimpilanSelisihCount > 0 ? 'text-bad' : 'text-ink/30'}`}>
                    {fmt(rimpilanStats.rimpilanSelisihCount)}
                  </div>
                </div>
              </div>

              {rimpilanStats.rimpilanSelisihPreview.length > 0 && (
                <div className="card p-5">
                  <div className="mb-3 text-sm font-medium">Material Rimpilan dengan Selisih Terbesar</div>
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-ink/50">
                      <tr>
                        <th className="pb-2 pr-3">Material</th>
                        <th className="pb-2 pr-3">Rak</th>
                        <th className="pb-2 pr-3 text-right">Qty SAP</th>
                        <th className="pb-2 pr-3 text-right">Qty Fisik</th>
                        <th className="pb-2 pr-3 text-right">Selisih</th>
                        <th className="pb-2 pr-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rimpilanStats.rimpilanSelisihPreview.map((r, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="py-2 pr-3 font-mono">{r.material}</td>
                          <td className="py-2 pr-3 font-mono">{r.storage_location}</td>
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

              <div className="grid gap-3 sm:grid-cols-2">
                <ActionLink
                  href={`/admin/sessions/${id}/upload/rimpilan`}
                  title="Upload Data Rimpilan"
                  desc="Tambah atau perbarui Data Master Rimpilan"
                />
                <ActionLink
                  href={`/admin/sessions/${id}/upload/racks`}
                  title="Upload Warehouse Racks"
                  desc="Mapping gudang → rak yang tersedia"
                />
              </div>
            </>
          )}
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
      <div className="mt-0.5 text-sm text-ink/50">Summary, Selisih (Normal + Rimpilan), Detail Scan</div>
    </button>
  );
}
