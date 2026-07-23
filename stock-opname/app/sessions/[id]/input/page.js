'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';

const KETERANGAN_OPTIONS = ['Pecah', 'Pallet rusak', 'Stock tidak terikat', 'Kardus rusak', 'Lainnya'];
const LEVELS = [1, 2, 3, 4, 5, 6, 7];

let keteranganUid = 0;
function nextKeteranganId() {
  keteranganUid += 1;
  return `ket-${keteranganUid}`;
}

export default function InputPage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [petugas, setPetugas] = useState('');
  const materialInputRef = useRef(null);
  const nomorRakRef = useRef(null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [sessionName, setSessionName] = useState('');

  // Recount mode: pulled from so_sessions. Kalau recountMaterials.length > 0,
  // petugas hanya boleh input material yang ada di daftar ini. Daftar ini
  // digabung dari selisih Normal SO + Rimpilan SO (lihat handleStartRecount
  // di admin dashboard) — recountSources memetakan tiap kode material ke
  // 'normal' | 'rimpilan' supaya petugas yang buka halaman Normal tahu
  // kalau sebuah kode sebenarnya harus di-recount lewat halaman Rimpilan.
  const [activeRecountRound, setActiveRecountRound] = useState(0);
  const [recountMaterials, setRecountMaterials] = useState([]); // string[] material codes
  const [recountSources, setRecountSources] = useState({}); // { [code]: 'normal' | 'rimpilan' }
  // Snapshot of Qty SAP / Qty Tercatat / Selisih taken by Accounting the
  // moment "Mulai Recount" was clicked (see app/admin/sessions/[id]/page.js)
  // — shown to petugas ONLY here, in recount mode, so they know exactly
  // what to double-check. Never shown during a first/normal count (that
  // stays blind on purpose).
  const [recountSnapshots, setRecountSnapshots] = useState({}); // { [code]: {qtySap, qtyTercatat, selisih, baseUom} }
  const recountMode = recountMaterials.length > 0;

  // Only materials whose source is 'normal' are actionable on THIS page —
  // rimpilan-only codes would hit "Material/Batch tidak ada di Master Data"
  // here since they typically don't live in so_sap_data, which is confusing.
  // They're surfaced instead as a pointer to the Rimpilan input page.
  const normalRecountMaterials = recountMaterials.filter((c) => recountSources[c] !== 'rimpilan');
  const rimpilanOnlyRecountMaterials = recountMaterials.filter((c) => recountSources[c] === 'rimpilan');

  const [materialCode, setMaterialCode] = useState('');
  const [showRecountSuggestions, setShowRecountSuggestions] = useState(false);
  const [lookupState, setLookupState] = useState('idle'); // idle | searching | found | notfound
  const [batchOptions, setBatchOptions] = useState([]); // sap rows sharing the material code
  const [selectedRow, setSelectedRow] = useState(null); // chosen sap row (or null if not-in-SAP / batch not matched)
  const [statusSap, setStatusSap] = useState('ditemukan');

  // Two-step confirmation: the first time a material code or batch doesn't
  // match Master Data, we only let the petugas go back and check again —
  // no way to save yet, so a fat-fingered scan can't sneak through. If they
  // deliberately re-enter the EXACT same value a second time, that's taken
  // as "yes I checked, this really isn't in Master Data" and a Tetap Simpan
  // button appears. Tracked as the last not-found value per field; matching
  // it again on the next attempt is what flips into confirm mode.
  const [materialNotFoundAttempt, setMaterialNotFoundAttempt] = useState(null);
  const [materialConfirmedNotFound, setMaterialConfirmedNotFound] = useState(false);
  const [showNotFoundModal, setShowNotFoundModal] = useState(false);

  const [batchMode, setBatchMode] = useState('select'); // 'select' | 'manual'
  const [manualBatch, setManualBatch] = useState('');
  const [batchNotFoundAttempt, setBatchNotFoundAttempt] = useState(null);
  const [batchConfirmedNotFound, setBatchConfirmedNotFound] = useState(false);

  const [nomorRak, setNomorRak] = useState('');
  // No default, same reasoning as Rimpilan — the physical shelf level can
  // differ between counts, so it's not something master data or a previous
  // save should pre-fill. Petugas picks it fresh every time.
  const [level, setLevel] = useState('');
  const [qtyFisik, setQtyFisik] = useState('');
  const [manualUom, setManualUom] = useState(''); // only used when material isn't in SAP
  const [uomOptions, setUomOptions] = useState([]);
  const [keterangan, setKeterangan] = useState([]); // [{id, jenis, qty, catatan}]

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);

  // Same 2-step pattern as the not-found flows: if material+batch+plant+
  // storage+rak already has a normal-qty entry in the CURRENT round, that's
  // probably an accidental double-scan (two petugas hit the same spot, or
  // one petugas resubmits) rather than a real second count — so the first
  // attempt only warns, the second (identical) attempt is allowed through.
  // Keterangan Khusus-only rows are excluded from this check since multiple
  // condition notes for the same spot are normal.
  const [duplicateWarning, setDuplicateWarning] = useState(null); // { existing } | null
  const [duplicateConfirmedKey, setDuplicateConfirmedKey] = useState(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(`so_petugas_${id}`);
    if (!saved) {
      router.replace(`/sessions/${id}/start`);
      return;
    }
    setPetugas(saved);
    loadSessionRecountState();

    // Pull the UoM options straight from this session's Data SAP so the
    // dropdown always matches Master Data instead of relying on free text.
    supabase
      .from('so_sap_data')
      .select('base_uom')
      .eq('session_id', id)
      .then(({ data }) => {
        const distinct = [...new Set((data || []).map((r) => r.base_uom).filter(Boolean))].sort();
        setUomOptions(distinct);
      });

    // Deep-link from the Material Selisih page (?material=...&rak=...) —
    // pre-fills and auto-runs the lookup so petugas doesn't have to
    // retype the code they just tapped on.
    const prefillMaterial = searchParams.get('material');
    const prefillRak = searchParams.get('rak');
    if (prefillMaterial) {
      setMaterialCode(prefillMaterial);
      runMaterialLookup(prefillMaterial);
    }
    if (prefillRak) setNomorRak(prefillRak);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router]);

  async function loadSessionRecountState() {
    const { data } = await supabase
      .from('so_sessions')
      .select('active_recount_round, recount_material_codes, status, name')
      .eq('id', id)
      .single();
    if (data) {
      setSessionStatus(data.status || null);
      setSessionName(data.name || '');
      setActiveRecountRound(data.active_recount_round || 0);
      const codes = data.recount_material_codes || [];
      // recount_material_codes is an array of { code, source } objects —
      // source lets us split "recount here" vs "recount on the Rimpilan
      // page" without a second query.
      if (codes.length > 0 && typeof codes[0] === 'object') {
        setRecountMaterials(codes.map((c) => c.code));
        setRecountSources(Object.fromEntries(codes.map((c) => [c.code, c.source || 'normal'])));
        setRecountSnapshots(Object.fromEntries(codes.map((c) => [c.code, {
          qtySap: c.qtySap, qtyTercatat: c.qtyTercatat, selisih: c.selisih, baseUom: c.baseUom,
        }])));
      } else {
        setRecountMaterials(codes);
        setRecountSources(Object.fromEntries(codes.map((c) => [c, 'normal'])));
        setRecountSnapshots({});
      }
    }
  }

  async function handleMaterialKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    await runMaterialLookup(materialCode.trim());
  }

  async function runMaterialLookup(code) {
    if (!code) return;

    if (recountMode && !normalRecountMaterials.includes(code)) {
      if (recountSources[code] === 'rimpilan') {
        setError(`Material "${code}" adalah item Rimpilan — recount lewat halaman Input Rimpilan, bukan di sini.`);
      } else {
        setError(`Material "${code}" tidak sedang di-recount. Pilih dari daftar yang tersedia.`);
      }
      return;
    }

    setShowRecountSuggestions(false);
    setLookupState('searching');
    setError(null);
    resetBatchState();
    const { data, error } = await supabase
      .from('so_sap_data')
      .select('*')
      .eq('session_id', id)
      .ilike('material', code);

    if (error) {
      setError(error.message);
      setLookupState('idle');
      return;
    }

    if (!data || data.length === 0) {
      const isSecondAttempt = materialNotFoundAttempt && materialNotFoundAttempt.toLowerCase() === code.toLowerCase();
      setMaterialConfirmedNotFound(isSecondAttempt);
      setMaterialNotFoundAttempt(code);
      setLookupState('notfound');
      setStatusSap('tidak_ada_di_sap');
      setShowNotFoundModal(true);
      return;
    }

    setMaterialNotFoundAttempt(null);
    setMaterialConfirmedNotFound(false);

    // Distinct batches for this material
    const distinctBatches = [...new Map(data.map((r) => [r.batch, r])).values()];
    setBatchOptions(distinctBatches);
    setStatusSap('ditemukan');

    if (distinctBatches.length === 1) {
      setSelectedRow(distinctBatches[0]);
      setLookupState('found');
      focusNomorRak();
    } else {
      setSelectedRow(null);
      setLookupState('found'); // shows batch dropdown until chosen
    }
  }

  function focusNomorRak() {
    setTimeout(() => nomorRakRef.current?.focus(), 50);
  }

  function resetBatchState() {
    setBatchMode('select');
    setManualBatch('');
    setBatchNotFoundAttempt(null);
    setBatchConfirmedNotFound(false);
    setBatchOptions([]);
    setSelectedRow(null);
  }

  function handleBatchSelect(batch) {
    const row = batchOptions.find((r) => r.batch === batch);
    setSelectedRow(row || null);
    setBatchConfirmedNotFound(false);
    setBatchNotFoundAttempt(null);
    if (row) focusNomorRak();
  }

  function switchToManualBatch() {
    setBatchMode('manual');
    setSelectedRow(null);
    setManualBatch('');
    setBatchNotFoundAttempt(null);
    setBatchConfirmedNotFound(false);
  }

  function switchToBatchDropdown() {
    setBatchMode('select');
    setManualBatch('');
    setBatchNotFoundAttempt(null);
    setBatchConfirmedNotFound(false);
    setSelectedRow(batchOptions.length === 1 ? batchOptions[0] : null);
  }

  // Called when the petugas finishes typing a manual batch (Enter or blur).
  // Same two-step rule as material code: first mismatch = check-again only,
  // matching the same typed value a second time = allowed to proceed.
  function confirmManualBatch() {
    const typed = manualBatch.trim();
    if (!typed) return;
    const match = batchOptions.find((r) => r.batch?.toLowerCase() === typed.toLowerCase());
    if (match) {
      setSelectedRow(match);
      setBatchConfirmedNotFound(false);
      setBatchNotFoundAttempt(null);
      focusNomorRak();
      return;
    }
    const isSecondAttempt = batchNotFoundAttempt && batchNotFoundAttempt.toLowerCase() === typed.toLowerCase();
    setBatchConfirmedNotFound(isSecondAttempt);
    setBatchNotFoundAttempt(typed);
    setSelectedRow(null);
    if (isSecondAttempt) focusNomorRak();
  }

  function handleNotFoundKembali() {
    setShowNotFoundModal(false);
    setLookupState('idle');
    setMaterialCode('');
    setTimeout(() => materialInputRef.current?.focus(), 50);
  }

  function handleNotFoundTetapSimpan() {
    setShowNotFoundModal(false);
    setSelectedRow(null);
    focusNomorRak();
  }

  function addKeterangan() {
    setKeterangan((prev) => [...prev, { id: nextKeteranganId(), jenis: KETERANGAN_OPTIONS[0], qty: '', catatan: '' }]);
  }

  function updateKeterangan(ketId, patch) {
    setKeterangan((prev) => prev.map((k) => (k.id === ketId ? { ...k, ...patch } : k)));
  }

  function removeKeterangan(ketId) {
    setKeterangan((prev) => prev.filter((k) => k.id !== ketId));
  }

  function resetForm() {
    setMaterialCode('');
    setLookupState('idle');
    setBatchOptions([]);
    setSelectedRow(null);
    setStatusSap('ditemukan');
    setMaterialNotFoundAttempt(null);
    setMaterialConfirmedNotFound(false);
    resetBatchState();
    setNomorRak('');
    setLevel('');
    setQtyFisik('');
    setManualUom('');
    setKeterangan([]);
    setDuplicateWarning(null);
    setDuplicateConfirmedKey(null);
    setTimeout(() => materialInputRef.current?.focus(), 50);
    // Refresh recount state in case Accounting started/stopped recount
    // while petugas was mid-session.
    loadSessionRecountState();
  }

  async function handleSave(e) {
    e.preventDefault();
    setError(null);

    if (recountMode && !normalRecountMaterials.includes(materialCode.trim())) {
      setError('Material ini tidak sedang di-recount di halaman ini. Pilih dari daftar yang tersedia.');
      return;
    }
    if (lookupState !== 'found' && !(lookupState === 'notfound' && materialConfirmedNotFound)) {
      setError('Cari Material Code terlebih dahulu (tekan Enter). Kalau tidak ditemukan, cek lagi lalu ketik ulang kode yang sama untuk konfirmasi.');
      return;
    }
    if (statusSap === 'ditemukan') {
      if (batchOptions.length > 1 && batchMode === 'select' && !selectedRow) {
        setError('Pilih Batch terlebih dahulu.');
        return;
      }
      if (batchMode === 'manual' && !selectedRow) {
        if (!batchConfirmedNotFound) {
          setError('Batch tidak ditemukan di Master Data. Cek lagi, lalu ketik ulang batch yang sama untuk konfirmasi.');
          return;
        }
        // confirmed not-found batch — allowed, falls through as
        // "Material/Batch tidak ada di Master Data"
      }
    }
    if (!nomorRak.trim()) {
      setError('Nomor Rak wajib diisi.');
      return;
    }
    if (!level) {
      setError('Level wajib dipilih (1-7).');
      return;
    }

    const hasNormalQty = qtyFisik !== '' && qtyFisik !== null;
    const hasKeteranganQty = keterangan.some((k) => k.qty !== '' && k.qty !== null);
    if (!hasNormalQty && !hasKeteranganQty) {
      setError('Isi minimal satu Qty (Qty Fisik atau Keterangan Khusus).');
      return;
    }

    if (hasNormalQty) {
      const effectiveRound = recountMode ? activeRecountRound : 0;
      // Level is part of the key — same material+batch+rak at a DIFFERENT
      // level is a legitimate separate count (mirrors Rimpilan), not a
      // duplicate, so it must not trip this warning.
      const dupKey = [materialCode.trim(), selectedRow?.batch || '', selectedRow?.plant || '', selectedRow?.storage_location || '', nomorRak.trim(), level].join('|');
      if (dupKey !== duplicateConfirmedKey) {
        setCheckingDuplicate(true);
        const { data: existingEntries } = await supabase
          .from('so_entries')
          .select('petugas_nama, qty_fisik, created_at')
          .eq('session_id', id)
          .eq('material_code', materialCode.trim())
          .eq('nomor_rak', nomorRak.trim())
          .eq('level', level)
          .eq('recount_round', effectiveRound)
          .is('keterangan_khusus', null)
          .order('created_at', { ascending: false })
          .limit(1);
        setCheckingDuplicate(false);
        if (existingEntries && existingEntries.length > 0) {
          setDuplicateWarning({ existing: existingEntries[0] });
          setDuplicateConfirmedKey(dupKey);
          setError('Kombinasi Material + Rak + Level ini sudah pernah diinput sebelumnya (lihat catatan di bawah). Tekan Simpan sekali lagi kalau memang mau menambahkan sebagai input tambahan.');
          return;
        }
      }
    }
    setDuplicateWarning(null);

    const rowsToInsert = [];
    if (hasNormalQty) {
      const qtyNum = Number(qtyFisik);
      if (Number.isNaN(qtyNum) || qtyNum < 0) {
        setError('Qty Fisik harus berupa angka >= 0.');
        return;
      }
      rowsToInsert.push({ qty_fisik: qtyNum, keterangan_khusus: null, keterangan_catatan: null });
    }
    for (const k of keterangan) {
      if (k.qty === '' || k.qty === null) continue;
      const qtyNum = Number(k.qty);
      if (Number.isNaN(qtyNum) || qtyNum < 0) {
        setError(`Keterangan Khusus "${k.jenis}": Qty harus berupa angka >= 0.`);
        return;
      }
      rowsToInsert.push({ qty_fisik: qtyNum, keterangan_khusus: k.jenis, keterangan_catatan: k.catatan?.trim() || null });
    }

    // Effective status_sap covers BOTH "material code not found" and
    // "material found but this batch isn't in Master Data" — reconciliation
    // keys on material+batch+plant+storage anyway, so an unmatched batch
    // already falls through to "Tidak Ada di SAP" naturally; this just
    // makes the label explicit for the Detail Scan / notification views.
    const effectiveStatusSap = selectedRow ? 'ditemukan' : 'tidak_ada_di_sap';
    const effectiveBatch = selectedRow?.batch || (batchMode === 'manual' ? manualBatch.trim() : null) || null;

    const base = {
      session_id: id,
      petugas_nama: petugas,
      material_code: materialCode.trim(),
      material_description: selectedRow?.material_description || batchOptions[0]?.material_description || null,
      batch: effectiveBatch,
      plant: selectedRow?.plant || batchOptions[0]?.plant || null,
      storage_location: selectedRow?.storage_location || null,
      nomor_rak: nomorRak.trim(),
      level: Number(level),
      base_uom: selectedRow?.base_uom || batchOptions[0]?.base_uom || manualUom.trim() || null,
      status_sap: effectiveStatusSap,
      // Di-stamp otomatis dari session — petugas tidak perlu tahu/pilih
      // round-nya, Accounting yang mengontrol lewat tombol "Mulai Recount".
      recount_round: recountMode ? activeRecountRound : 0,
    };

    setSaving(true);
    const { error } = await supabase.from('so_entries').insert(rowsToInsert.map((r) => ({ ...base, ...r })));
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setLastSaved({
      ...base,
      qty_fisik: rowsToInsert.reduce((s, r) => s + (r.keterangan_khusus ? 0 : r.qty_fisik), 0),
      keteranganCount: rowsToInsert.filter((r) => r.keterangan_khusus).length,
      isRecount: recountMode,
    });
    resetForm();
  }

  const showBatchPicker = lookupState === 'found' && statusSap === 'ditemukan' && batchOptions.length > 1 && batchMode === 'select' && !selectedRow;
  // The "batch not matched" case has its own inline message right under the
  // manual-batch input (with the recheck/confirm copy) — this block only
  // covers "found row" details and the "material entirely unknown" case, so
  // the two messages never show at once and contradict each other.
  const showDetails = !!selectedRow || (lookupState === 'notfound' && materialConfirmedNotFound);

  const filteredRecountSuggestions = recountMode
    ? normalRecountMaterials.filter((m) => m.toLowerCase().includes(materialCode.trim().toLowerCase())).slice(0, 8)
    : [];

  if (sessionStatus === 'closed') {
    return (
      <div className="mx-auto max-w-lg">
        <Link href="/mulai" className="text-xs text-ink/50 hover:text-ink">← Pilih Session</Link>
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
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/mulai" className="text-xs text-ink/50 hover:text-ink">← Pilih Session</Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Input Stock Opname</h1>
        </div>
        <div className="badge bg-slate-850/10 text-ink">{petugas}</div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Link
          href={`/sessions/${id}/rimpilan/input`}
          className="card block p-3.5 text-sm transition hover:border-amber/60 hover:shadow-md"
        >
          <span className="font-medium text-ink">Input Rimpilan →</span>
          <span className="ml-2 text-ink/50">Untuk material yang dihitung per-rak, bukan satu-satu</span>
        </Link>
        <Link
          href={`/sessions/${id}/selisih`}
          className="card block p-3.5 text-sm transition hover:border-amber/60 hover:shadow-md"
        >
          <span className="font-medium text-ink">Rak Selisih →</span>
          <span className="ml-2 text-ink/50">Lihat yang perlu dicek ulang, real-time</span>
        </Link>
      </div>

      {recountMode && (
        <div className="card border-warn/40 bg-warn/10 p-3.5 text-sm">
          <div className="font-medium text-warn">🔄 Mode Recount aktif (Round {activeRecountRound})</div>
          <p className="mt-1 text-ink/60">
            Hanya {normalRecountMaterials.length} material yang selisih yang bisa di-input di halaman ini.
            Material lain otomatis ditolak.
          </p>
          {rimpilanOnlyRecountMaterials.length > 0 && (
            <p className="mt-1 text-ink/60">
              {rimpilanOnlyRecountMaterials.length} material lain adalah item Rimpilan yang selisih —
              recount lewat{' '}
              <Link href={`/sessions/${id}/rimpilan/input`} className="font-medium underline">
                halaman Input Rimpilan
              </Link>.
            </p>
          )}

          {normalRecountMaterials.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-warn/20 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="text-ink/50">
                  <tr>
                    <th className="px-2.5 py-2">Material</th>
                    <th className="px-2.5 py-2 text-right">Qty SAP</th>
                    <th className="px-2.5 py-2 text-right">Qty Tercatat</th>
                    <th className="px-2.5 py-2 text-right">Selisih</th>
                  </tr>
                </thead>
                <tbody>
                  {normalRecountMaterials.map((code) => {
                    const snap = recountSnapshots[code];
                    return (
                      <tr key={code} className="border-t border-line">
                        <td className="px-2.5 py-1.5 font-mono">{code}</td>
                        {snap ? (
                          <>
                            <td className="px-2.5 py-1.5 text-right font-mono">{snap.qtySap} {snap.baseUom}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono">{snap.qtyTercatat} {snap.baseUom}</td>
                            <td className={`px-2.5 py-1.5 text-right font-mono ${snap.selisih > 0 ? 'text-warn' : 'text-bad'}`}>
                              {snap.selisih > 0 ? '+' : ''}{snap.selisih}
                            </td>
                          </>
                        ) : (
                          <td className="px-2.5 py-1.5 text-ink/30" colSpan={3}>— (dari sebelum fitur ini aktif)</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {lastSaved && (
        <div className={`card p-3 text-sm ${lastSaved.isRecount ? 'border-warn/30 bg-warn/5 text-warn' : 'border-good/30 bg-good/5 text-good'}`}>
          {lastSaved.isRecount && '🔄 '}Tersimpan: {lastSaved.material_code} · Rak {lastSaved.nomor_rak} (Lv {lastSaved.level})
          {lastSaved.qty_fisik > 0 && ` · Qty ${lastSaved.qty_fisik}${lastSaved.base_uom ? ` ${lastSaved.base_uom}` : ''}`}
          {lastSaved.keteranganCount > 0 && ` · ${lastSaved.keteranganCount} Keterangan Khusus`}
        </div>
      )}

      <form onSubmit={handleSave} className="card space-y-4 p-5">
        <div className="relative">
          <label className="label-field">Material Code</label>
          <input
            ref={materialInputRef}
            className="input-field font-mono"
            value={materialCode}
            onChange={(e) => {
              setMaterialCode(e.target.value);
              if (recountMode) setShowRecountSuggestions(true);
            }}
            onFocus={() => recountMode && setShowRecountSuggestions(true)}
            onBlur={() => setTimeout(() => setShowRecountSuggestions(false), 150)}
            onKeyDown={handleMaterialKeyDown}
            placeholder={recountMode ? 'Cari material yang selisih...' : 'Ketik atau scan, lalu Enter'}
            autoFocus
          />
          {lookupState === 'searching' && (
            <div className="mt-1.5 text-xs text-ink/50">Mencari...</div>
          )}

          {/* Recount mode: searchable dropdown restricted to selisih materials only */}
          {recountMode && showRecountSuggestions && filteredRecountSuggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">
              {filteredRecountSuggestions.map((code) => (
                <li key={code}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left font-mono text-sm hover:bg-paper"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setMaterialCode(code);
                      runMaterialLookup(code);
                    }}
                  >
                    {code}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {recountMode && showRecountSuggestions && materialCode.trim() && filteredRecountSuggestions.length === 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-white p-3 text-xs text-ink/50 shadow-lg">
              Tidak ada material selisih yang cocok.
            </div>
          )}
        </div>

        {showBatchPicker && (
          <div>
            <label className="label-field">Pilih Batch</label>
            <select
              className="input-field"
              onChange={(e) => handleBatchSelect(e.target.value)}
              defaultValue=""
            >
              <option value="" disabled>Pilih batch...</option>
              {batchOptions.map((r) => (
                <option key={r.batch} value={r.batch}>
                  {r.batch} — {r.storage_location}
                </option>
              ))}
            </select>
            <button type="button" onClick={switchToManualBatch} className="mt-1.5 text-xs font-medium text-slate-850 hover:underline">
              Batch tidak ada di daftar? Input manual →
            </button>
          </div>
        )}

        {lookupState === 'found' && statusSap === 'ditemukan' && batchMode === 'manual' && (
          <div>
            <label className="label-field">Batch (manual)</label>
            <input
              className="input-field font-mono"
              value={manualBatch}
              onChange={(e) => {
                setManualBatch(e.target.value);
                setBatchConfirmedNotFound(false);
              }}
              onBlur={confirmManualBatch}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmManualBatch();
                }
              }}
              placeholder="Ketik batch, lalu Enter"
            />
            {batchOptions.length > 0 && (
              <button type="button" onClick={switchToBatchDropdown} className="mt-1.5 text-xs font-medium text-slate-850 hover:underline">
                ← Pilih dari daftar batch
              </button>
            )}
            {manualBatch.trim() && !selectedRow && (
              <div className={`mt-2 rounded-lg p-2.5 text-xs ${batchConfirmedNotFound ? 'bg-warn/10 text-warn' : 'bg-bad/5 text-bad'}`}>
                {batchConfirmedNotFound
                  ? `Batch "${manualBatch.trim()}" tetap tidak ditemukan di Master Data — akan disimpan sebagai Material/Batch tidak ada di Master Data.`
                  : `Batch "${manualBatch.trim()}" tidak ditemukan di Master Data. Cek lagi kode batch-nya — kalau memang benar, ketik ulang batch yang sama untuk konfirmasi.`}
              </div>
            )}
          </div>
        )}

        {showDetails && (
          <div className="rounded-lg bg-paper p-3.5 text-sm">
            {selectedRow ? (
              <div className="grid grid-cols-2 gap-y-1.5">
                <span className="text-ink/50">Material</span>
                <span className="font-mono">{materialCode}</span>
                <span className="text-ink/50">Description</span>
                <span>{selectedRow.material_description}</span>
                <span className="text-ink/50">Batch</span>
                <span className="font-mono">{selectedRow.batch}</span>
                <span className="text-ink/50">Storage Location</span>
                <span>{selectedRow.storage_location}</span>
                <span className="text-ink/50">Base Unit of Measure</span>
                <span className="font-mono">{selectedRow.base_uom || '—'}</span>
                <span></span>
                <button type="button" onClick={switchToManualBatch} className="justify-self-start text-xs font-medium text-slate-850 hover:underline">
                  Bukan batch ini? Input manual →
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-warn">
                  Material "{materialCode}" — Material/Batch Tidak Ada di Master Data. Data akan tetap disimpan.
                </div>
                <div>
                  <label className="label-field">Base Unit of Measure</label>
                  <select
                    className="input-field font-mono"
                    value={manualUom}
                    onChange={(e) => setManualUom(e.target.value)}
                  >
                    <option value="">Pilih UoM...</option>
                    {uomOptions.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-field">Nomor Rak</label>
            <input
              ref={nomorRakRef}
              className="input-field"
              value={nomorRak}
              onChange={(e) => setNomorRak(e.target.value)}
              placeholder="A-01-01"
            />
          </div>
          <div>
            <label className="label-field">Level</label>
            <select className="input-field" value={level} onChange={(e) => setLevel(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="" disabled>Pilih level...</option>
              {LEVELS.map((lv) => (
                <option key={lv} value={lv}>{lv}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label-field">
              Qty Fisik{selectedRow?.base_uom ? ` (${selectedRow.base_uom})` : ''}
            </label>
            <input
              className="input-field"
              type="number"
              min="0"
              value={qtyFisik}
              onChange={(e) => setQtyFisik(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        {/* ============ Keterangan Khusus — sama seperti Input Rimpilan ============
            Metadata kondisi barang, qty-nya terpisah dari Qty Fisik normal di
            atas dan TIDAK ikut dijumlah ke Selisih (lihat lib/reconciliation.js). */}
        <div>
          <div className="flex items-center justify-between">
            <label className="label-field mb-0">Keterangan Khusus</label>
          </div>
          {keterangan.map((k) => (
            <div key={k.id} className="mt-2 rounded-lg bg-paper p-2.5">
              <div className="flex items-center gap-2">
                <select
                  className="input-field flex-1"
                  value={k.jenis}
                  onChange={(e) => updateKeterangan(k.id, { jenis: e.target.value })}
                >
                  {KETERANGAN_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <input
                  className="input-field w-24"
                  type="number"
                  min="0"
                  value={k.qty}
                  onChange={(e) => updateKeterangan(k.id, { qty: e.target.value })}
                  placeholder="Qty"
                />
                <button type="button" onClick={() => removeKeterangan(k.id)} className="shrink-0 text-ink/30 hover:text-bad">✕</button>
              </div>
              {k.jenis === 'Lainnya' && (
                <input
                  className="input-field mt-2"
                  value={k.catatan}
                  onChange={(e) => updateKeterangan(k.id, { catatan: e.target.value })}
                  placeholder="Jelaskan kondisi..."
                />
              )}
            </div>
          ))}
          <button type="button" onClick={addKeterangan} className="mt-2 text-xs font-medium text-slate-850 hover:underline">
            + Tambah Keterangan Khusus
          </button>
        </div>

        {duplicateWarning?.existing && (
          <div className="rounded-lg bg-warn/10 p-3 text-xs text-warn">
            Sudah pernah diinput: {duplicateWarning.existing.qty_fisik} oleh {duplicateWarning.existing.petugas_nama},{' '}
            {new Date(duplicateWarning.existing.created_at).toLocaleString('id-ID')}. Kalau ditekan Simpan lagi,
            qty ini akan DITAMBAHKAN ke total (bukan menimpa).
          </div>
        )}

        {error && <div className="text-sm text-bad">{error}</div>}

        <button type="submit" className="btn-amber w-full" disabled={saving || checkingDuplicate}>
          {checkingDuplicate ? 'Mengecek...' : saving ? 'Menyimpan...' : 'Simpan & Input Berikutnya'}
        </button>
      </form>

      {showNotFoundModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg">
            <div className="font-medium">Material tidak ditemukan pada Master Data.</div>
            <p className="mt-2 text-sm text-ink/60">Kemungkinan penyebab:</p>
            <ul className="mt-1 list-inside list-disc text-sm text-ink/60">
              <li>Material baru belum ada pada Data SAP.</li>
              <li>Salah input Material Code.</li>
              <li>Data SAP belum diperbarui.</li>
            </ul>
            {materialConfirmedNotFound ? (
              <>
                <p className="mt-3 text-sm font-medium">
                  Kode yang sama diketik dua kali — apakah Anda yakin ingin tetap menyimpan data ini sebagai
                  Material/Batch tidak ada di Master Data?
                </p>
                <div className="mt-4 flex gap-2">
                  <button onClick={handleNotFoundKembali} className="btn-ghost flex-1">Kembali</button>
                  <button onClick={handleNotFoundTetapSimpan} className="btn-primary flex-1">Tetap Simpan</button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm font-medium">
                  Cek lagi Material Code-nya. Kalau memang benar, ketik ulang kode yang sama untuk konfirmasi.
                </p>
                <div className="mt-4">
                  <button onClick={handleNotFoundKembali} className="btn-primary w-full">Kembali, Cek Lagi</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
