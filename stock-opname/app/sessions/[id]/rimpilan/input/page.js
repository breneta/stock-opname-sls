'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../../../lib/supabaseClient';
import { fetchAll } from '../../../../../lib/fetchAll';
import { parseRecountCodes } from '../../../../../lib/recountCodes';

const KETERANGAN_OPTIONS = ['Pecah', 'Pallet rusak', 'Stock tidak terikat', 'Kardus rusak', 'Lainnya'];
const LEVELS = [1, 2, 3, 4, 5, 6, 7];

let keteranganUid = 0;
function nextKeteranganId() {
  keteranganUid += 1;
  return `ket-${keteranganUid}`;
}

export default function RimpilanInputPage() {
  const { id } = useParams();
  const router = useRouter();

  const [petugas, setPetugas] = useState('');
  const [loading, setLoading] = useState(true);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [sessionName, setSessionName] = useState('');

  const [warehouses, setWarehouses] = useState([]); // string[]
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [racksByWarehouse, setRacksByWarehouse] = useState({}); // { [warehouse]: Set<rackCode> }
  const [materials, setMaterials] = useState([]); // rimpilan_sap_data rows
  const [openRaks, setOpenRaks] = useState({}); // { [rak]: bool }
  const [rowState, setRowState] = useState({}); // { [rimpilanSapDataId]: { level, normalQty, keterangan: [{id, jenis, qty, catatan}] } }

  // Recount: this page only ever restricts by material code (not by rak),
  // since Accounting's recount list is material-driven, same as Normal SO.
  const [activeRecountRound, setActiveRecountRound] = useState(0);
  const [recountCodes, setRecountCodes] = useState([]); // material codes eligible for recount HERE
  const recountMode = recountCodes.length > 0;
  const [recountSearch, setRecountSearch] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // Info-only heads-up (never blocks) shown when a normal-qty entry already
  // exists for the exact same material + rak + level in the current round.
  // Unlike Normal SO, this can't be a 2-step block — the same material+rak
  // legitimately gets entered multiple times across different levels, so
  // the check has to be scoped down to level too, and even then it's just a
  // "heads up, you already did this one" note rather than a hard stop —
  // the accordion is meant for fast bulk entry, adding friction here would
  // defeat the point.
  const [duplicateNotes, setDuplicateNotes] = useState({}); // { [rowId]: { qty, petugas, created_at } | undefined }

  // Self-void: sama seperti Normal SO — petugas boleh batalkan entry lama
  // sendiri, tapi HANYA untuk material yang sudah di-approve Admin masuk
  // daftar recount (recountCodes). Di luar recount, tetap harus lewat
  // Kelola Entry punya Admin. Riwayat di-load lazy per baris material,
  // karena recount mode di sini list-nya flat (banyak material sekaligus
  // kelihatan), bukan satu material terpilih seperti Normal SO.
  const [historyByRow, setHistoryByRow] = useState({}); // { [rowId]: entries[] }
  const [loadingHistoryRow, setLoadingHistoryRow] = useState(null);
  const [openHistoryRow, setOpenHistoryRow] = useState(null);
  const [voidingHistoryKey, setVoidingHistoryKey] = useState(null); // `${source}:${id}`
  const [historyVoidReason, setHistoryVoidReason] = useState('');
  const [savingHistoryVoid, setSavingHistoryVoid] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(`so_petugas_${id}`);
    if (!saved) {
      router.replace(`/sessions/${id}/start`);
      return;
    }
    setPetugas(saved);
    load();
  }, [id, router]);

  async function load() {
    setLoading(true);
    const [{ data: sessionData }, racksData, materialsData] = await Promise.all([
      supabase.from('so_sessions').select('active_recount_round, recount_material_codes, status, name').eq('id', id).single(),
      fetchAll(() => supabase.from('warehouse_racks').select('*').eq('session_id', id)),
      fetchAll(() => supabase.from('rimpilan_sap_data').select('*').eq('session_id', id).order('material_code')),
    ]);

    setSessionStatus(sessionData?.status || null);
    setSessionName(sessionData?.name || '');

    const whList = [...new Set((racksData || []).map((r) => r.warehouse_code))].sort();
    setWarehouses(whList);
    const map = {};
    for (const r of racksData || []) {
      (map[r.warehouse_code] ||= new Set()).add(r.rack_code);
    }
    setRacksByWarehouse(map);
    setMaterials(materialsData || []);
    if (!selectedWarehouse && whList.length > 0) setSelectedWarehouse(whList[0]);

    if (sessionData) {
      setActiveRecountRound(sessionData.active_recount_round || 0);
      // Only entries tagged 'rimpilan' or 'both' are actionable on this
      // page. parseRecountCodes also unwraps rows where an entry ended up
      // as a JSON-encoded string instead of a parsed object.
      const codes = parseRecountCodes(sessionData.recount_material_codes);
      const eligibleCodes = codes.filter((c) => c.source !== 'normal');
      setRecountCodes(eligibleCodes.map((c) => c.code));
    }
    setLoading(false);
  }

  // Level has no default — master data doesn't carry it (a rimpilan pile's
  // shelf level can differ between counts), so petugas must pick it fresh
  // every time. Empty string, not a number, until they actually choose.
  function getRowState(row) {
    return rowState[row.id] || { level: '', normalQty: '', keterangan: [] };
  }

  function updateRow(rowId, patch) {
    setRowState((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] || { level: '', normalQty: '', keterangan: [] }), ...patch },
    }));
  }

  // Fires whenever a Level is picked/changed on a row — looks up whether
  // that exact material + rak + level already has a normal-qty entry this
  // round, purely to surface a "sudah pernah diisi" note under the field.
  async function checkDuplicateLevel(row, level) {
    if (!level) {
      setDuplicateNotes((prev) => ({ ...prev, [row.id]: undefined }));
      return;
    }
    const { data } = await supabase
      .from('rimpilan_entries')
      .select('petugas_nama, qty_fisik, created_at')
      .eq('session_id', id)
      .eq('material_code', row.material_code)
      .eq('nomor_rak', row.nomor_rak)
      .eq('level', level)
      .eq('recount_round', recountMode ? activeRecountRound : 0)
      .is('keterangan_khusus', null)
      .is('voided_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    setDuplicateNotes((prev) => ({ ...prev, [row.id]: data && data.length > 0 ? data[0] : undefined }));
  }

  async function fetchHistoryForRow(row) {
    setLoadingHistoryRow(row.id);
    const [{ data: normal }, { data: rimpilan }] = await Promise.all([
      supabase
        .from('so_entries')
        .select('*')
        .eq('session_id', id)
        .eq('material_code', row.material_code)
        .is('voided_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('rimpilan_entries')
        .select('*')
        .eq('session_id', id)
        .eq('material_code', row.material_code)
        .is('voided_at', null)
        .order('created_at', { ascending: false }),
    ]);
    const unified = [
      ...(normal || []).map((e) => ({ ...e, source: 'normal' })),
      ...(rimpilan || []).map((e) => ({ ...e, source: 'rimpilan' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    setHistoryByRow((prev) => ({ ...prev, [row.id]: unified }));
    setLoadingHistoryRow(null);
  }

  function toggleHistory(row) {
    if (openHistoryRow === row.id) {
      setOpenHistoryRow(null);
      return;
    }
    setOpenHistoryRow(row.id);
    if (!historyByRow[row.id]) fetchHistoryForRow(row);
  }

  function startHistoryVoid(entry) {
    setHistoryVoidReason('');
    setVoidingHistoryKey(`${entry.source}:${entry.id}`);
  }

  async function confirmHistoryVoid(row, entry) {
    // Re-check the guard right before writing, not just trusting the UI
    // state — this material must still be on the Admin-approved recount list.
    if (!recountMode || !recountCodes.includes(entry.material_code)) {
      setError('Material ini tidak sedang di-recount — tidak bisa dibatalkan sendiri. Hubungi Admin.');
      setVoidingHistoryKey(null);
      return;
    }
    const reason = historyVoidReason.trim();
    if (!reason) {
      setError('Alasan pembatalan wajib diisi.');
      return;
    }
    setSavingHistoryVoid(true);
    setError(null);
    const table = entry.source === 'normal' ? 'so_entries' : 'rimpilan_entries';
    const { error: updateError } = await supabase
      .from(table)
      .update({ voided_at: new Date().toISOString(), voided_by: petugas, void_reason: reason })
      .eq('id', entry.id);
    setSavingHistoryVoid(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setVoidingHistoryKey(null);
    setHistoryVoidReason('');
    fetchHistoryForRow(row);
  }

  function addKeterangan(row) {
    const current = getRowState(row);
    updateRow(row.id, {
      keterangan: [...current.keterangan, { id: nextKeteranganId(), jenis: KETERANGAN_OPTIONS[0], qty: '', catatan: '' }],
    });
  }

  function updateKeterangan(row, ketId, patch) {
    const current = getRowState(row);
    updateRow(row.id, {
      keterangan: current.keterangan.map((k) => (k.id === ketId ? { ...k, ...patch } : k)),
    });
  }

  function removeKeterangan(row, ketId) {
    const current = getRowState(row);
    updateRow(row.id, { keterangan: current.keterangan.filter((k) => k.id !== ketId) });
  }

  // Materials for the selected warehouse, grouped by Nomor Rak. A rak only
  // shows up here if it's part of warehouse_racks for the selected
  // warehouse — if Warehouse Racks hasn't been uploaded yet, nothing
  // groups (see the empty-state warning below).
  const rakGroups = useMemo(() => {
    const rackSet = racksByWarehouse[selectedWarehouse];
    const relevant = rackSet ? materials.filter((m) => rackSet.has(m.nomor_rak)) : [];
    const groups = new Map();
    for (const m of relevant) {
      if (!groups.has(m.nomor_rak)) groups.set(m.nomor_rak, []);
      groups.get(m.nomor_rak).push(m);
    }
    return [...groups.entries()]
      .map(([rak, list]) => ({ rak, list: list.sort((a, b) => a.material_code.localeCompare(b.material_code)) }))
      .sort((a, b) => a.rak.localeCompare(b.rak));
  }, [materials, racksByWarehouse, selectedWarehouse]);

  const recountRows = useMemo(() => {
    if (!recountMode) return [];
    const term = recountSearch.trim().toLowerCase();
    return materials
      .filter((m) => recountCodes.includes(m.material_code))
      .filter((m) => !term || m.material_code.toLowerCase().includes(term))
      .sort((a, b) => a.material_code.localeCompare(b.material_code));
  }, [materials, recountCodes, recountMode, recountSearch]);

  function toggleRak(rak) {
    setOpenRaks((prev) => ({ ...prev, [rak]: !prev[rak] }));
  }

  function buildEntriesToSave(rows) {
    const entries = [];
    const rowErrors = [];

    for (const row of rows) {
      const state = rowState[row.id];
      if (!state) continue;

      const hasNormalQty = state.normalQty !== '' && state.normalQty !== undefined && state.normalQty !== null;
      const hasKeterangan = (state.keterangan || []).some((k) => k.qty !== '' && k.qty !== undefined && k.qty !== null);
      if (!hasNormalQty && !hasKeterangan) continue; // row completely untouched — skip silently

      // Normal Qty is always required once a row has anything filled in —
      // Keterangan Khusus is optional metadata on top of it, not a
      // substitute. A row with only a Keterangan Khusus qty filled in is
      // now a validation error instead of a silent partial save.
      if (!hasNormalQty) {
        rowErrors.push(`${row.material_code}: Normal Qty wajib diisi`);
        continue;
      }

      const level = Number(state.level);
      if (!state.level || Number.isNaN(level) || level < 1 || level > 7) {
        rowErrors.push(`${row.material_code}: Level wajib dipilih (1-7)`);
        continue;
      }

      const base = {
        session_id: id,
        petugas_nama: petugas,
        material_code: row.material_code,
        material_description: row.material_description,
        batch: row.batch,
        plant: row.plant,
        storage_location: row.storage_location,
        nomor_rak: row.nomor_rak,
        level,
        recount_round: recountMode ? activeRecountRound : 0,
      };

      if (hasNormalQty) {
        const qty = Number(state.normalQty);
        if (Number.isNaN(qty) || qty < 0) {
          rowErrors.push(`${row.material_code}: Normal Qty harus angka >= 0`);
        } else {
          entries.push({ ...base, qty_fisik: qty, keterangan_khusus: null, keterangan_catatan: null });
        }
      }

      for (const k of state.keterangan || []) {
        if (k.qty === '' || k.qty === undefined || k.qty === null) continue;
        const qty = Number(k.qty);
        if (Number.isNaN(qty) || qty < 0) {
          rowErrors.push(`${row.material_code} (${k.jenis}): Qty harus angka >= 0`);
          continue;
        }
        entries.push({ ...base, qty_fisik: qty, keterangan_khusus: k.jenis, keterangan_catatan: k.catatan?.trim() || null });
      }
    }

    return { entries, rowErrors };
  }

  async function handleSaveAll(rowsInScope) {
    setError(null);
    setResult(null);

    const { entries, rowErrors } = buildEntriesToSave(rowsInScope);

    if (rowErrors.length > 0) {
      setError(rowErrors.join(' · '));
      return;
    }
    if (entries.length === 0) {
      setError('Isi minimal satu Qty (Normal atau Keterangan Khusus) sebelum menyimpan.');
      return;
    }

    setSaving(true);
    const { error: insertError } = await supabase.from('rimpilan_entries').insert(entries);
    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    // Clear only the rows that were actually part of this save.
    setRowState((prev) => {
      const next = { ...prev };
      for (const row of rowsInScope) delete next[row.id];
      return next;
    });
    setResult({ count: entries.length, materials: new Set(entries.map((e) => e.material_code)).size });
    load(); // refresh recount state in case Accounting changed it mid-session
  }

  if (loading) return <div className="mx-auto max-w-lg text-sm text-ink/50">Memuat...</div>;

  if (sessionStatus === 'closed') {
    return (
      <div className="mx-auto max-w-lg">
        <Link href={`/sessions/${id}/input`} className="text-xs text-ink/50 hover:text-ink">← Input Normal SO</Link>
        <div className="card mt-3 border-warn/40 bg-warn/10 p-5">
          <div className="font-medium text-warn">Session sudah ditutup</div>
          <p className="mt-1 text-sm text-ink/60">
            {sessionName || 'Session ini'} sudah ditutup oleh Accounting. Tidak bisa input lagi. Kalau ini
            keliru, hubungi Accounting untuk buka ulang session-nya.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/sessions/${id}/input`} className="text-xs text-ink/50 hover:text-ink">← Input Normal SO</Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Input Rimpilan</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/sessions/${id}/selisih`} className="text-xs font-medium text-slate-850 hover:underline">
            Rak Selisih →
          </Link>
          <div className="badge bg-slate-850/10 text-ink">{petugas}</div>
        </div>
      </div>

      {recountMode && (
        <div className="card border-warn/40 bg-warn/10 p-3.5 text-sm">
          <div className="font-medium text-warn">🔄 Mode Recount aktif (Round {activeRecountRound})</div>
          <p className="mt-1 text-ink/60">
            Hanya {recountCodes.length} material Rimpilan yang selisih yang bisa di-input sekarang.
          </p>
          {recountCodes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {recountCodes.map((code) => (
                <span key={code} className="badge bg-white font-mono text-ink/70">{code}</span>
              ))}
            </div>
          )}

          <Link href={`/sessions/${id}/selisih`} className="mt-2 inline-block text-xs font-medium text-slate-850 hover:underline">
            Lihat rak &amp; siapa yang terakhir hitung di Rak Selisih →
          </Link>
        </div>
      )}

      {error && <div className="card border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div>}
      {result && (
        <div className="card border-good/30 bg-good/5 p-3 text-sm text-good">
          ✓ Tersimpan: {result.count} baris untuk {result.materials} material.
        </div>
      )}

      {recountMode ? (
        // ============ Recount mode: restricted searchable list, flat (no accordion) ============
        <div className="card space-y-4 p-5">
          <div>
            <label className="label-field">Cari Material yang Selisih</label>
            <input
              className="input-field font-mono"
              value={recountSearch}
              onChange={(e) => setRecountSearch(e.target.value)}
              placeholder="Ketik kode material..."
              autoFocus
            />
          </div>

          {recountRows.length === 0 ? (
            <div className="py-6 text-center text-sm text-ink/40">Tidak ada material yang cocok.</div>
          ) : (
            <div className="space-y-3">
              {recountRows.map((row) => (
                <MaterialRowEditor
                  key={row.id}
                  row={row}
                  state={getRowState(row)}
                  onChange={(patch) => updateRow(row.id, patch)}
                  onAddKeterangan={() => addKeterangan(row)}
                  onUpdateKeterangan={(ketId, patch) => updateKeterangan(row, ketId, patch)}
                  onRemoveKeterangan={(ketId) => removeKeterangan(row, ketId)}
                  onLevelChange={(level) => checkDuplicateLevel(row, level)}
                  duplicateNote={duplicateNotes[row.id]}
                  showHistory
                  historyOpen={openHistoryRow === row.id}
                  onToggleHistory={() => toggleHistory(row)}
                  loadingHistory={loadingHistoryRow === row.id}
                  historyEntries={historyByRow[row.id] || []}
                  voidingHistoryKey={voidingHistoryKey}
                  onStartHistoryVoid={startHistoryVoid}
                  onConfirmHistoryVoid={(entry) => confirmHistoryVoid(row, entry)}
                  onCancelHistoryVoid={() => setVoidingHistoryKey(null)}
                  historyVoidReason={historyVoidReason}
                  onHistoryVoidReasonChange={setHistoryVoidReason}
                  savingHistoryVoid={savingHistoryVoid}
                />
              ))}
            </div>
          )}

          <button
            onClick={() => handleSaveAll(recountRows)}
            disabled={saving || recountRows.length === 0}
            className="btn-amber w-full"
          >
            {saving ? 'Menyimpan...' : 'Simpan Recount'}
          </button>
        </div>
      ) : (
        // ============ Normal mode: warehouse -> rak accordion ============
        <>
          {warehouses.length === 0 ? (
            <div className="card border-amber/40 bg-amber/10 p-5 text-sm">
              <div className="font-medium">Belum ada Warehouse Racks</div>
              <p className="mt-1 text-ink/60">
                Minta Accounting upload mapping Warehouse Racks dulu supaya material bisa dikelompokkan per rak.
              </p>
            </div>
          ) : (
            <>
              <div className="card p-4">
                <label className="label-field">Warehouse</label>
                <select className="input-field" value={selectedWarehouse} onChange={(e) => setSelectedWarehouse(e.target.value)}>
                  {warehouses.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>

              {rakGroups.length === 0 ? (
                <div className="card p-6 text-center text-sm text-ink/40">
                  Tidak ada material Rimpilan yang rak-nya cocok dengan Warehouse ini. Cek Upload Data
                  Rimpilan / Upload Warehouse Racks.
                </div>
              ) : (
                <div className="space-y-3">
                  {rakGroups.map(({ rak, list }) => {
                    const isOpen = !!openRaks[rak];
                    const filledCount = list.filter((row) => {
                      const s = rowState[row.id];
                      return s && (s.normalQty !== '' || (s.keterangan || []).some((k) => k.qty !== ''));
                    }).length;
                    return (
                      <div key={rak} className="card overflow-hidden">
                        <button
                          onClick={() => toggleRak(rak)}
                          className="flex w-full items-center justify-between p-4 text-left transition hover:bg-paper"
                        >
                          <span className="font-medium">
                            Rak {rak} <span className="text-ink/40">({list.length} materials)</span>
                          </span>
                          <span className="flex items-center gap-2 text-xs text-ink/50">
                            {filledCount > 0 && <span className="badge bg-good/10 text-good">{filledCount} terisi</span>}
                            <span>{isOpen ? '▲' : '▼'}</span>
                          </span>
                        </button>
                        {isOpen && (
                          <div className="space-y-3 border-t border-line p-4">
                            {list.map((row) => (
                              <MaterialRowEditor
                                key={row.id}
                                row={row}
                                state={getRowState(row)}
                                onChange={(patch) => updateRow(row.id, patch)}
                                onAddKeterangan={() => addKeterangan(row)}
                                onUpdateKeterangan={(ketId, patch) => updateKeterangan(row, ketId, patch)}
                                onRemoveKeterangan={(ketId) => removeKeterangan(row, ketId)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                onClick={() => handleSaveAll(rakGroups.flatMap((g) => g.list))}
                disabled={saving || rakGroups.length === 0}
                className="btn-amber sticky bottom-4 w-full shadow-lg"
              >
                {saving ? 'Menyimpan...' : 'Simpan Semua Input'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

// One material row inside the accordion (or the recount flat list) —
// Level dropdown, Normal Qty, and zero-or-more Keterangan Khusus rows.
// Master qty is deliberately never shown here (fresh count, per spec).
function MaterialRowEditor({
  row, state, onChange, onAddKeterangan, onUpdateKeterangan, onRemoveKeterangan, onLevelChange, duplicateNote,
  showHistory, historyOpen, onToggleHistory, loadingHistory, historyEntries, voidingHistoryKey,
  onStartHistoryVoid, onConfirmHistoryVoid, onCancelHistoryVoid, historyVoidReason, onHistoryVoidReasonChange, savingHistoryVoid,
}) {
  return (
    <div className="rounded-lg border border-line p-3.5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-medium">{row.material_code}</div>
          <div className="text-xs text-ink/50">{row.material_description}</div>
        </div>
        {showHistory && (
          <button type="button" onClick={onToggleHistory} className="shrink-0 text-xs font-medium text-slate-850 hover:underline">
            {historyOpen ? 'Tutup riwayat' : 'Riwayat & batalkan →'}
          </button>
        )}
      </div>

      {showHistory && historyOpen && (
        <div className="mb-3 rounded-lg border border-warn/30 bg-warn/5 p-2.5 text-xs">
          <p className="text-ink/50">
            Kalau ada entry lama dengan rak/batch yang salah, bisa dibatalkan langsung di sini — tidak perlu
            tunggu Admin, karena material ini sudah di-approve untuk recount. Alasan wajib diisi.
          </p>
          {loadingHistory ? (
            <div className="mt-2 text-ink/40">Memuat riwayat...</div>
          ) : historyEntries.length === 0 ? (
            <div className="mt-2 text-ink/40">Belum ada entry sebelumnya untuk material ini.</div>
          ) : (
            <div className="mt-2 space-y-2">
              {historyEntries.map((h) => {
                const hKey = `${h.source}:${h.id}`;
                return (
                  <div key={hKey} className="rounded-lg border border-line bg-white p-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className="badge bg-slate-850/10 text-ink/70">{h.source === 'normal' ? 'Normal' : 'Rimpilan'}</span>
                        {h.recount_round > 0 && <span className="badge ml-1 bg-amber/20 text-warn">R{h.recount_round}</span>}
                        <div className="mt-1 text-ink/60">
                          Batch {h.batch || '-'} · Rak {h.nomor_rak || '-'} · Lv {h.level ?? '-'}
                          {h.keterangan_khusus ? ` · ${h.keterangan_khusus} (Qty ${h.qty_fisik})` : ` · Qty ${h.qty_fisik} ${h.base_uom || ''}`}
                        </div>
                        <div className="mt-0.5 text-ink/40">{h.petugas_nama} · {new Date(h.created_at).toLocaleString('id-ID')}</div>
                      </div>
                      {voidingHistoryKey !== hKey && (
                        <button type="button" onClick={() => onStartHistoryVoid(h)} className="btn-ghost shrink-0 text-xs text-bad">
                          Batalkan →
                        </button>
                      )}
                    </div>
                    {voidingHistoryKey === hKey && (
                      <div className="mt-2 space-y-1.5 border-t border-line pt-2">
                        <textarea
                          className="input-field"
                          rows={2}
                          value={historyVoidReason}
                          onChange={(e) => onHistoryVoidReasonChange(e.target.value)}
                          placeholder="Alasan: contoh salah rak, seharusnya A-02"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={savingHistoryVoid}
                            onClick={() => onConfirmHistoryVoid(h)}
                            className="inline-flex items-center justify-center rounded-lg bg-bad px-3 py-1.5 text-xs font-medium text-white transition hover:bg-bad/90 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
                          >
                            {savingHistoryVoid ? 'Menyimpan...' : 'Konfirmasi Batalkan'}
                          </button>
                          <button type="button" onClick={onCancelHistoryVoid} className="btn-ghost text-xs">
                            Batal
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-field">Level</label>
          <select
            className="input-field"
            value={state.level}
            onChange={(e) => {
              const level = e.target.value === '' ? '' : Number(e.target.value);
              onChange({ level });
              onLevelChange?.(level);
            }}
          >
            <option value="" disabled>Pilih level...</option>
            {LEVELS.map((lv) => (
              <option key={lv} value={lv}>{lv}</option>
            ))}
          </select>
          {duplicateNote && (
            <div className="mt-1 text-xs text-warn">
              Sudah pernah diisi: {duplicateNote.qty_fisik} oleh {duplicateNote.petugas_nama}. Input baru akan ditambahkan, bukan menimpa.
            </div>
          )}
        </div>
        <div>
          <label className="label-field">Normal Qty{row.base_uom ? ` (${row.base_uom})` : ''}</label>
          <input
            className="input-field"
            type="number"
            min="0"
            value={state.normalQty}
            onChange={(e) => onChange({ normalQty: e.target.value })}
            placeholder="0"
          />
        </div>
      </div>

      {(state.keterangan || []).map((k) => (
        <div key={k.id} className="mt-2.5 rounded-lg bg-paper p-2.5">
          {/* Explicit grid track widths instead of flex-grow — a flex row
              here kept letting the <select> collapse to just its arrow
              regardless of flex-1/min-w-0, because native <select> intrinsic
              sizing fights the flex algorithm on some browsers. Grid tracks
              are a hard pixel contract the browser can't renegotiate away. */}
          <div className="grid items-center gap-2" style={{ gridTemplateColumns: '1fr 4.5rem auto' }}>
            <select
              className="input-field w-full"
              value={k.jenis}
              onChange={(e) => onUpdateKeterangan(k.id, { jenis: e.target.value })}
            >
              {KETERANGAN_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <input
              className="input-field w-full"
              type="number"
              min="0"
              value={k.qty}
              onChange={(e) => onUpdateKeterangan(k.id, { qty: e.target.value })}
              placeholder="Qty"
            />
            <button type="button" onClick={() => onRemoveKeterangan(k.id)} className="shrink-0 text-ink/30 hover:text-bad">✕</button>
          </div>
          {k.jenis === 'Lainnya' && (
            <input
              className="input-field mt-2"
              value={k.catatan}
              onChange={(e) => onUpdateKeterangan(k.id, { catatan: e.target.value })}
              placeholder="Jelaskan kondisi..."
            />
          )}
        </div>
      ))}

      <button type="button" onClick={onAddKeterangan} className="mt-2.5 text-xs font-medium text-slate-850 hover:underline">
        + Tambah Keterangan Khusus
      </button>
    </div>
  );
}
