'use client';

// Rimpilan Input — accordion per rak, fresh count (master qty hidden).
// Mirrors the append-only, petugas-in-localStorage pattern of
// app/sessions/[id]/input/page.js (normal SO), but the unit of work here
// is "a whole rak", not one material lookup at a time.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '../../../../../lib/supabaseClient';
import { PLANTS } from '../../../../../lib/plants';

const LEVEL_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const KETERANGAN_OPTIONS = ['Pecah', 'Pallet rusak', 'Stock tidak terikat', 'Kardus rusak', 'Lainnya'];

function rowKey(r) {
  return r.id; // rimpilan_sap_data.id — already unique per material+batch+rak+level
}

function emptyDraft(masterRow) {
  return {
    level: masterRow.level || 1,
    normalQty: '',
    keteranganList: [], // [{ uid, type, qty, catatan }]
  };
}

let keteranganUid = 0;

export default function RimpilanInputPage() {
  const { id } = useParams();

  // --- Petugas gate (localStorage, same key as normal SO so the name
  // carries over between the two tabs of the same session) ---
  const [petugas, setPetugas] = useState('');
  const [petugasInput, setPetugasInput] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(`so_petugas_${id}`);
    if (saved) setPetugas(saved);
  }, [id]);

  function handleSetPetugas(e) {
    e.preventDefault();
    const name = petugasInput.trim();
    if (!name) return;
    localStorage.setItem(`so_petugas_${id}`, name);
    setPetugas(name);
  }

  // --- Recount mode (shared session state with normal SO) ---
  const [activeRecountRound, setActiveRecountRound] = useState(0);
  const [recountMaterials, setRecountMaterials] = useState([]);
  const recountMode = recountMaterials.length > 0;

  // --- Warehouse (plant) + master data grouped by rak ---
  const [warehouse, setWarehouse] = useState('');
  const [masterRows, setMasterRows] = useState([]);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [openRaks, setOpenRaks] = useState({}); // rak -> bool

  // --- Draft state: masterRow.id -> draft ---
  const [drafts, setDrafts] = useState({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saveResult, setSaveResult] = useState(null);

  useEffect(() => {
    if (!petugas) return;
    loadRecountState();
  }, [id, petugas]);

  useEffect(() => {
    if (!petugas || !warehouse) return;
    loadMaster();
  }, [id, petugas, warehouse]);

  async function loadRecountState() {
    const { data } = await supabase
      .from('so_sessions')
      .select('active_recount_round, recount_material_codes')
      .eq('id', id)
      .single();
    if (data) {
      setActiveRecountRound(data.active_recount_round || 0);
      setRecountMaterials(data.recount_material_codes || []);
    }
  }

  async function loadMaster() {
    setLoadingMaster(true);
    setError(null);
    let query = supabase
      .from('rimpilan_sap_data')
      .select('*')
      .eq('session_id', id)
      .eq('plant', warehouse)
      .order('nomor_rak')
      .order('material_code');
    const { data, error } = await query;
    setLoadingMaster(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Recount mode: only materials currently flagged as selisih are
    // shown — same restriction as normal SO input, applied here at the
    // rak-grouping level so racks with nothing to recount collapse away.
    const rows = recountMode ? (data || []).filter((r) => recountMaterials.includes(r.material_code)) : data || [];
    setMasterRows(rows);
    setDrafts({});
    // Default: open every rak that has materials, so petugas sees the
    // whole warehouse at once instead of hunting for the toggle.
    const initialOpen = {};
    rows.forEach((r) => { initialOpen[r.nomor_rak] = true; });
    setOpenRaks(initialOpen);
  }

  const groupedByRak = useMemo(() => {
    const map = new Map();
    for (const r of masterRows) {
      if (!map.has(r.nomor_rak)) map.set(r.nomor_rak, []);
      map.get(r.nomor_rak).push(r);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [masterRows]);

  function toggleRak(rak) {
    setOpenRaks((prev) => ({ ...prev, [rak]: !prev[rak] }));
  }

  function getDraft(masterRow) {
    return drafts[rowKey(masterRow)] || emptyDraft(masterRow);
  }

  function updateDraft(masterRow, patch) {
    setDrafts((prev) => ({
      ...prev,
      [rowKey(masterRow)]: { ...getDraft(masterRow), ...patch },
    }));
  }

  function addKeterangan(masterRow) {
    const draft = getDraft(masterRow);
    keteranganUid += 1;
    updateDraft(masterRow, {
      keteranganList: [...draft.keteranganList, { uid: keteranganUid, type: KETERANGAN_OPTIONS[0], qty: '', catatan: '' }],
    });
  }

  function updateKeterangan(masterRow, uid, patch) {
    const draft = getDraft(masterRow);
    updateDraft(masterRow, {
      keteranganList: draft.keteranganList.map((k) => (k.uid === uid ? { ...k, ...patch } : k)),
    });
  }

  function removeKeterangan(masterRow, uid) {
    const draft = getDraft(masterRow);
    updateDraft(masterRow, { keteranganList: draft.keteranganList.filter((k) => k.uid !== uid) });
  }

  // Berapa material yang sudah diisi (normal qty dan/atau min. 1 keterangan
  // dengan qty valid) — dipakai untuk badge & validasi sebelum simpan.
  const touchedCount = useMemo(() => {
    return masterRows.filter((r) => {
      const d = drafts[rowKey(r)];
      if (!d) return false;
      const hasNormal = d.normalQty !== '' && d.normalQty !== null;
      const hasKeterangan = d.keteranganList.some((k) => k.qty !== '' && k.qty !== null);
      return hasNormal || hasKeterangan;
    }).length;
  }, [masterRows, drafts]);

  function validateAndBuildEntries() {
    const entries = [];
    for (const r of masterRows) {
      const d = drafts[rowKey(r)];
      if (!d) continue;

      const level = Number(d.level);
      if (!LEVEL_OPTIONS.includes(level)) {
        throw new Error(`${r.material_code}: Level tidak valid.`);
      }

      const hasNormal = d.normalQty !== '' && d.normalQty !== null;
      if (hasNormal) {
        const qty = Number(d.normalQty);
        if (Number.isNaN(qty) || qty < 0) throw new Error(`${r.material_code}: Normal Qty harus angka >= 0.`);
        entries.push({
          session_id: id,
          petugas_nama: petugas,
          material_code: r.material_code,
          material_description: r.material_description,
          batch: r.batch,
          plant: r.plant,
          storage_location: r.storage_location,
          nomor_rak: r.nomor_rak,
          level,
          qty_fisik: qty,
          keterangan_khusus: null,
          keterangan_catatan: null,
          recount_round: recountMode ? activeRecountRound : 0,
        });
      }

      for (const k of d.keteranganList) {
        if (k.qty === '' || k.qty === null) continue; // baris keterangan kosong = diabaikan, bukan error
        const qty = Number(k.qty);
        if (Number.isNaN(qty) || qty < 0) throw new Error(`${r.material_code}: Qty ${k.type} harus angka >= 0.`);
        if (k.type === 'Lainnya' && !k.catatan.trim()) {
          throw new Error(`${r.material_code}: Catatan wajib diisi untuk keterangan "Lainnya".`);
        }
        entries.push({
          session_id: id,
          petugas_nama: petugas,
          material_code: r.material_code,
          material_description: r.material_description,
          batch: r.batch,
          plant: r.plant,
          storage_location: r.storage_location,
          nomor_rak: r.nomor_rak,
          level,
          qty_fisik: qty,
          keterangan_khusus: k.type,
          keterangan_catatan: k.catatan.trim() || null,
          recount_round: recountMode ? activeRecountRound : 0,
        });
      }
    }
    return entries;
  }

  async function handleSaveAll() {
    setError(null);
    setSaveResult(null);
    let entries;
    try {
      entries = validateAndBuildEntries();
    } catch (err) {
      setError(err.message);
      return;
    }
    if (entries.length === 0) {
      setError('Belum ada material yang diisi.');
      return;
    }

    setSaving(true);
    const chunkSize = 500;
    let inserted = 0;
    const failedChunks = [];
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      const { error } = await supabase.from('rimpilan_entries').insert(chunk);
      if (error) failedChunks.push({ from: i + 1, to: i + chunk.length, message: error.message });
      else inserted += chunk.length;
    }
    setSaving(false);

    if (failedChunks.length > 0) {
      setError(`${inserted} dari ${entries.length} baris tersimpan. Gagal: ${failedChunks.map((f) => f.message).join('; ')}`);
      return;
    }

    setSaveResult({ count: entries.length, materials: touchedCount });
    setDrafts({});
    loadRecountState(); // refresh in case Accounting started/stopped recount mid-session
  }

  if (!petugas) {
    return (
      <div className="mx-auto max-w-sm">
        <form onSubmit={handleSetPetugas} className="card space-y-3 p-5">
          <h1 className="text-lg font-semibold tracking-tight">Input Rimpilan</h1>
          <p className="text-sm text-ink/60">Masukkan nama Anda untuk mulai menghitung.</p>
          <input
            className="input-field"
            value={petugasInput}
            onChange={(e) => setPetugasInput(e.target.value)}
            placeholder="Nama petugas"
            autoFocus
          />
          <button type="submit" className="btn-primary w-full">Mulai</button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/mulai" className="text-xs text-ink/50 hover:text-ink">← Pilih Session</Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Input Rimpilan</h1>
        </div>
        <div className="badge bg-slate-850/10 text-ink">{petugas}</div>
      </div>

      {recountMode && (
        <div className="card border-warn/40 bg-warn/10 p-3.5 text-sm">
          <div className="font-medium text-warn">🔄 Mode Recount aktif (Round {activeRecountRound})</div>
          <p className="mt-1 text-ink/60">
            Hanya material yang selisih yang ditampilkan di bawah — rak tanpa material selisih
            otomatis tersembunyi.
          </p>
        </div>
      )}

      <div className="card p-5">
        <label className="label-field">Warehouse / Area</label>
        <select className="input-field" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
          <option value="">Pilih warehouse...</option>
          {PLANTS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {loadingMaster && <div className="text-sm text-ink/50">Memuat data rimpilan...</div>}

      {!loadingMaster && warehouse && groupedByRak.length === 0 && (
        <div className="card p-4 text-center text-sm text-ink/40">
          {recountMode
            ? 'Tidak ada material rimpilan yang selisih di warehouse ini untuk recount saat ini.'
            : 'Belum ada Master Rimpilan untuk warehouse ini. Hubungi Accounting untuk upload.'}
        </div>
      )}

      {saveResult && (
        <div className="card border-good/30 bg-good/5 p-3 text-sm text-good">
          ✓ {saveResult.count} entri tersimpan untuk {saveResult.materials} material.
        </div>
      )}
      {error && <div className="card border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div>}

      {groupedByRak.map(([rak, rows]) => {
        const isOpen = openRaks[rak];
        const filledInRak = rows.filter((r) => {
          const d = drafts[rowKey(r)];
          return d && (d.normalQty !== '' || d.keteranganList.some((k) => k.qty !== ''));
        }).length;

        return (
          <div key={rak} className="card overflow-hidden p-0">
            <button
              type="button"
              onClick={() => toggleRak(rak)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="font-medium">Rak {rak} ({rows.length} material{rows.length > 1 ? 's' : ''})</span>
              <span className="flex items-center gap-2 text-xs text-ink/50">
                {filledInRak > 0 && <span className="badge bg-good/10 text-good">{filledInRak} terisi</span>}
                {isOpen ? '▲' : '▼'}
              </span>
            </button>

            {isOpen && (
              <div className="divide-y divide-line border-t border-line">
                {rows.map((r) => {
                  const d = getDraft(r);
                  return (
                    <div key={r.id} className="space-y-3 p-4">
                      <div>
                        <div className="font-mono text-sm font-medium">{r.material_code}</div>
                        <div className="text-xs text-ink/50">{r.material_description}{r.batch ? ` · Batch ${r.batch}` : ''}</div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="label-field">Level</label>
                          <select
                            className="input-field"
                            value={d.level}
                            onChange={(e) => updateDraft(r, { level: Number(e.target.value) })}
                          >
                            {LEVEL_OPTIONS.map((lv) => (
                              <option key={lv} value={lv}>{lv}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label-field">Normal Qty{r.base_uom ? ` (${r.base_uom})` : ''}</label>
                          <input
                            type="number"
                            min="0"
                            className="input-field"
                            value={d.normalQty}
                            onChange={(e) => updateDraft(r, { normalQty: e.target.value })}
                            placeholder="0"
                          />
                        </div>
                      </div>

                      {d.keteranganList.map((k) => (
                        <div key={k.uid} className="rounded-lg bg-paper p-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="label-field">Keterangan Khusus</label>
                              <select
                                className="input-field"
                                value={k.type}
                                onChange={(e) => updateKeterangan(r, k.uid, { type: e.target.value })}
                              >
                                {KETERANGAN_OPTIONS.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="label-field">Qty {k.type}</label>
                              <input
                                type="number"
                                min="0"
                                className="input-field"
                                value={k.qty}
                                onChange={(e) => updateKeterangan(r, k.uid, { qty: e.target.value })}
                                placeholder="0"
                              />
                            </div>
                          </div>
                          {k.type === 'Lainnya' && (
                            <div className="mt-2">
                              <label className="label-field">Catatan (wajib)</label>
                              <input
                                className="input-field"
                                value={k.catatan}
                                onChange={(e) => updateKeterangan(r, k.uid, { catatan: e.target.value })}
                                placeholder="Jelaskan kondisi..."
                              />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => removeKeterangan(r, k.uid)}
                            className="mt-2 text-xs text-bad hover:underline"
                          >
                            Hapus keterangan ini
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() => addKeterangan(r)}
                        className="btn-ghost text-xs"
                      >
                        + Tambah Keterangan Khusus
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {groupedByRak.length > 0 && (
        <div className="sticky bottom-4">
          <button onClick={handleSaveAll} disabled={saving} className="btn-amber w-full shadow-lg">
            {saving ? 'Menyimpan...' : `Simpan Semua (${touchedCount} material terisi)`}
          </button>
        </div>
      )}
    </div>
  );
}
