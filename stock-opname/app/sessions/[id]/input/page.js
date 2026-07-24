'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { parseRecountCodes } from '../../../../lib/recountCodes';

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
  const recountMode = recountMaterials.length > 0;

  // Rak grouping for RECOUNT mode only — rak sangat krusial buat petugas
  // jalan fisik per rak, bukan loncat-loncat per kode material. Nomor rak
  // bukan master data buat Normal SO (tidak ada file upload material->rak
  // khusus) — ini dihitung dari histori so_entries + rimpilan_entries milik
  // tim lapangan sendiri, sama persis logikanya kayak Rak Selisih page.
  // Warehouse Racks (warehouse_racks, upload yang sudah ada) cuma dipakai
  // sebagai daftar rak valid untuk suggestion di field Nomor Rak, TIDAK
  // menentukan material apa ada di rak mana.
  const [recountRakGroups, setRecountRakGroups] = useState([]);
  const [openRak, setOpenRak] = useState(null);
  // { [materialCode]: sapRow[] } — valid batches per material dari Data SAP,
  // dipakai buat picker batch di tiap baris rak-editor recount.
  const [recountBatchOptions, setRecountBatchOptions] = useState({});
  // { [materialCode]: { batch, level, qtyFisik, keterangan: [], savedAt } }
  const [rakRowState, setRakRowState] = useState({});
  const [savingRak, setSavingRak] = useState(null);
  const [rakError, setRakError] = useState(null);
  // Which rak-row's Batch combobox currently has its suggestion list open —
  // one shared piece of state (keyed by material code) instead of per-row
  // state, same pattern as openHistoryFor.
  const [batchSuggestFor, setBatchSuggestFor] = useState(null);
  // Search-as-you-type filter for the "Pilih Rak" list — same UX pattern as
  // Batch/Material, dipakai kalau daftar rak-nya panjang.
  const [rakSearch, setRakSearch] = useState('');
  // Daftar rak yang valid dari Warehouse Racks (upload yang sudah ada) —
  // dipakai sebagai suggestion di field Nomor Rak (mode normal), bukan
  // penentu material.
  const [warehouseRackCodes, setWarehouseRackCodes] = useState([]);

  // Self-void: petugas bisa membatalkan entry LAMA milik material yang
  // sedang di-recount, tanpa nunggu Admin — tapi scope-nya dikunci ketat:
  // hanya material yang sudah di-approve Admin masuk daftar recount (lihat
  // normalRecountMaterials/recountMode). Di luar recount, tetap harus lewat
  // Kelola Entry punya Admin. Alasan tetap wajib diisi dan voided_by dicatat
  // nama petugas sendiri (bukan disamarkan jadi Admin), jadi jejaknya tetap
  // bisa ditelusuri Internal Audit.
  const [materialHistory, setMaterialHistory] = useState([]); // entries lama untuk material yg sedang dipilih
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [voidingHistoryKey, setVoidingHistoryKey] = useState(null); // `${source}:${id}`
  const [historyVoidReason, setHistoryVoidReason] = useState('');
  const [savingHistoryVoid, setSavingHistoryVoid] = useState(false);

  // Sama seperti di atas, tapi buat rak-editor bulk — banyak material
  // kelihatan sekaligus, jadi riwayatnya di-key per kode material, bukan
  // satu "material yang sedang dipilih" seperti flow scan biasa.
  const [historyByMaterial, setHistoryByMaterial] = useState({}); // { [code]: entries[] }
  const [loadingHistoryFor, setLoadingHistoryFor] = useState(null);
  const [openHistoryFor, setOpenHistoryFor] = useState(null);

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

  // Batch is a single search-as-you-type combobox now (not a separate
  // select/manual toggle): typing filters batchOptions live, clicking a
  // suggestion selects it, and typing something that matches nothing just
  // falls through to the same two-step not-found confirmation Material Code
  // already uses (batchNotFoundAttempt / batchConfirmedNotFound).
  const [manualBatch, setManualBatch] = useState('');
  const [showBatchSuggestions, setShowBatchSuggestions] = useState(false);
  const [batchNotFoundAttempt, setBatchNotFoundAttempt] = useState(null);
  const [batchConfirmedNotFound, setBatchConfirmedNotFound] = useState(false);

  // Same search-as-you-type combobox pattern as Batch — suggestions come
  // from Warehouse Racks (upload gudang biasa, bukan mapping per material),
  // tapi typing something not in the list tetap diterima (rak fisik boleh
  // belum terdaftar di master, ini cuma suggestion/fallback).
  const [nomorRak, setNomorRak] = useState('');
  const [showRakSuggestions, setShowRakSuggestions] = useState(false);
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

    // Deep-link from the Rak Selisih page (?material=...&rak=...). Rak
    // Selisih only ever links to materials that are already approved for
    // recount, so this just opens that rak in the bulk editor below instead
    // of running the old single-item lookup — the material itself is
    // already listed there once the rak is expanded.
    const prefillRak = searchParams.get('rak');
    if (prefillRak) setOpenRak(prefillRak);
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
      // recount_material_codes is an array of { code, source } objects —
      // source lets us split "recount here" vs "recount on the Rimpilan
      // page" without a second query. parseRecountCodes also unwraps rows
      // where an entry ended up as a JSON-encoded string instead of a
      // parsed object.
      const codes = parseRecountCodes(data.recount_material_codes);
      setRecountMaterials(codes.map((c) => c.code));
      setRecountSources(Object.fromEntries(codes.map((c) => [c.code, c.source || 'normal'])));

      const normalCodes = codes.filter((c) => c.source !== 'rimpilan').map((c) => c.code);
      if (normalCodes.length > 0) {
        loadRecountRakGroups(normalCodes);
        loadRecountBatchOptions(normalCodes);
      } else {
        setRecountRakGroups([]);
        setRecountBatchOptions({});
      }
    }
    loadWarehouseRackCodes();
  }

  // Sama persis pendekatannya dengan Rak Selisih page: kumpulkan rak dari
  // histori entry milik tim lapangan (bukan master data — tidak ada file
  // upload material->rak khusus Normal SO), lalu kelompokkan material per
  // rak. Material yang belum pernah dihitung sama sekali masuk ke bucket
  // "(belum pernah dihitung)" biar tetap kelihatan, bukan hilang diam-diam.
  // Batch terakhir yang pernah dipakai disimpan sebagai DEFAULT saja (bukan
  // dikunci) — kalau ternyata batch itu sendiri yang salah, petugas tetap
  // bisa ganti lewat picker (lihat recountBatchOptions).
  async function loadRecountRakGroups(codes) {
    const [{ data: normalEntries }, { data: rimpilanEntries }] = await Promise.all([
      supabase
        .from('so_entries')
        .select('material_code, material_description, nomor_rak, batch, created_at')
        .eq('session_id', id)
        .is('voided_at', null)
        .in('material_code', codes)
        .order('created_at', { ascending: false }),
      supabase
        .from('rimpilan_entries')
        .select('material_code, material_description, nomor_rak, batch, created_at')
        .eq('session_id', id)
        .is('voided_at', null)
        .in('material_code', codes)
        .order('created_at', { ascending: false }),
    ]);

    const byRak = new Map(); // rak -> Map<material_code, {material, material_description, lastBatch}>
    const addEntry = (e) => {
      const rak = e.nomor_rak || '(tanpa rak)';
      if (!byRak.has(rak)) byRak.set(rak, new Map());
      const group = byRak.get(rak);
      // Sorted by created_at desc already — the FIRST time we see this
      // material in this rak is its most recent entry, so don't overwrite.
      if (!group.has(e.material_code)) {
        group.set(e.material_code, { material: e.material_code, material_description: e.material_description, lastBatch: e.batch || null });
      }
    };
    for (const e of normalEntries || []) addEntry(e);
    for (const e of rimpilanEntries || []) addEntry(e);

    const seenCodes = new Set([...(normalEntries || []), ...(rimpilanEntries || [])].map((e) => e.material_code));
    const unseenCodes = codes.filter((c) => !seenCodes.has(c));
    if (unseenCodes.length > 0) {
      byRak.set(
        '(belum pernah dihitung)',
        new Map(unseenCodes.map((c) => [c, { material: c, material_description: '', lastBatch: null }]))
      );
    }

    const groups = [...byRak.entries()]
      .map(([rak, materialsMap]) => ({
        rak,
        materials: [...materialsMap.values()].sort((a, b) => a.material.localeCompare(b.material)),
      }))
      .sort((a, b) => a.rak.localeCompare(b.rak));

    setRecountRakGroups(groups);
  }

  // Prefetch semua batch valid (dari Data SAP) untuk material yang sedang
  // di-recount, sekali di awal — supaya tiap baris di rak-editor tidak perlu
  // query terpisah pas dibuka.
  async function loadRecountBatchOptions(codes) {
    const { data } = await supabase
      .from('so_sap_data')
      .select('*')
      .eq('session_id', id)
      .in('material', codes);
    const byMaterial = {};
    for (const row of data || []) {
      (byMaterial[row.material] ||= []).push(row);
    }
    setRecountBatchOptions(byMaterial);
  }

  // Warehouse Racks (upload yang sudah ada, dipakai juga oleh Input
  // Rimpilan) — di sini cuma jadi sumber suggestion buat field Nomor Rak,
  // bukan penentu material apa ada di rak mana.
  async function loadWarehouseRackCodes() {
    const { data } = await supabase.from('warehouse_racks').select('rack_code').eq('session_id', id);
    setWarehouseRackCodes([...new Set((data || []).map((r) => r.rack_code))].sort());
  }

  // Riwayat entry (belum voided) untuk satu material — dipakai buat panel
  // "Entry lama material ini" di bawah form, cuma muncul kalau recountMode
  // aktif DAN material-nya ada di daftar yang di-approve (dicek lagi di
  // caller, bukan cuma di sini).
  async function loadMaterialHistory(code) {
    setLoadingHistory(true);
    const [{ data: normal }, { data: rimpilan }] = await Promise.all([
      supabase
        .from('so_entries')
        .select('*')
        .eq('session_id', id)
        .eq('material_code', code)
        .is('voided_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('rimpilan_entries')
        .select('*')
        .eq('session_id', id)
        .eq('material_code', code)
        .is('voided_at', null)
        .order('created_at', { ascending: false }),
    ]);
    const unified = [
      ...(normal || []).map((e) => ({ ...e, source: 'normal' })),
      ...(rimpilan || []).map((e) => ({ ...e, source: 'rimpilan' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    setMaterialHistory(unified);
    setLoadingHistory(false);
  }

  function startHistoryVoid(entry) {
    setHistoryVoidReason('');
    setVoidingHistoryKey(`${entry.source}:${entry.id}`);
  }

  async function confirmHistoryVoid(entry) {
    // Re-check the guard right before writing — never trust that the UI
    // state alone kept this safe (materialCode could've changed under it).
    if (!recountMode || !normalRecountMaterials.includes(entry.material_code)) {
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
    loadMaterialHistory(entry.material_code);
  }

  // ============ Recount + Master Rak self-void history (per material) ============

  async function toggleRowHistory(code) {
    if (openHistoryFor === code) {
      setOpenHistoryFor(null);
      return;
    }
    setOpenHistoryFor(code);
    if (historyByMaterial[code]) return;
    setLoadingHistoryFor(code);
    const [{ data: normal }, { data: rimpilan }] = await Promise.all([
      supabase.from('so_entries').select('*').eq('session_id', id).eq('material_code', code).is('voided_at', null).order('created_at', { ascending: false }),
      supabase.from('rimpilan_entries').select('*').eq('session_id', id).eq('material_code', code).is('voided_at', null).order('created_at', { ascending: false }),
    ]);
    const unified = [
      ...(normal || []).map((e) => ({ ...e, source: 'normal' })),
      ...(rimpilan || []).map((e) => ({ ...e, source: 'rimpilan' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    setHistoryByMaterial((prev) => ({ ...prev, [code]: unified }));
    setLoadingHistoryFor(null);
  }

  // "Batalkan" di sini sekaligus "batalkan & tambah baru": begitu entry lama
  // di-void, baris rak untuk material ini langsung diisi ulang dari data
  // entry yang dibatalkan (batch/level/qty atau keterangan khusus) supaya
  // petugas tinggal koreksi field yang salah, bukan ngetik ulang dari nol —
  // lalu tetap harus tekan "Simpan Rak" seperti biasa untuk benar-benar
  // menyimpan baris baru itu (jadi belum ada perubahan data sebelum disimpan).
  async function confirmRowHistoryVoid(code, entry) {
    if (!recountMode || !normalRecountMaterials.includes(entry.material_code)) {
      setRakError('Material ini tidak sedang di-recount — tidak bisa dibatalkan sendiri. Hubungi Admin.');
      setVoidingHistoryKey(null);
      return;
    }
    const reason = historyVoidReason.trim();
    if (!reason) {
      setRakError('Alasan pembatalan wajib diisi.');
      return;
    }
    setSavingHistoryVoid(true);
    setRakError(null);
    const table = entry.source === 'normal' ? 'so_entries' : 'rimpilan_entries';
    const { error: updateError } = await supabase
      .from(table)
      .update({ voided_at: new Date().toISOString(), voided_by: petugas, void_reason: reason })
      .eq('id', entry.id);
    setSavingHistoryVoid(false);
    if (updateError) {
      setRakError(updateError.message);
      return;
    }
    setVoidingHistoryKey(null);
    setHistoryVoidReason('');
    setHistoryByMaterial((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });

    // Prefill baris rak dengan data entry yang baru dibatalkan, biar tinggal
    // dikoreksi. Kalau entry itu baris Keterangan Khusus, masuk ke daftar
    // keterangan (ditambahkan, bukan menimpa keterangan lain yang mungkin
    // sudah diisi); kalau baris Qty Fisik biasa, isi qtyFisik langsung.
    const currentRow = getRakRow(code);
    if (entry.keterangan_khusus) {
      updateRakRow(code, {
        batch: entry.batch || currentRow.batch,
        level: entry.level ?? currentRow.level,
        keterangan: [
          ...currentRow.keterangan,
          { id: nextKeteranganId(), jenis: entry.keterangan_khusus, qty: String(entry.qty_fisik ?? ''), catatan: entry.keterangan_catatan || '' },
        ],
      });
    } else {
      updateRakRow(code, {
        batch: entry.batch || currentRow.batch,
        level: entry.level ?? currentRow.level,
        qtyFisik: String(entry.qty_fisik ?? ''),
      });
    }

    toggleRowHistory(code); // will re-open + refetch since it's no longer cached
    setOpenHistoryFor(code);
    loadRecountRakGroups(normalRecountMaterials); // refresh "last batch" hints too
  }

  function getRakRow(code) {
    return rakRowState[code] || { batch: undefined, level: '', qtyFisik: '', keterangan: [], savedAt: null };
  }

  function updateRakRow(code, patch) {
    setRakRowState((prev) => ({
      ...prev,
      [code]: { ...getRakRow(code), ...patch, savedAt: null },
    }));
  }

  function addRakKeterangan(code) {
    const row = getRakRow(code);
    updateRakRow(code, { keterangan: [...row.keterangan, { id: nextKeteranganId(), jenis: KETERANGAN_OPTIONS[0], qty: '', catatan: '' }] });
  }

  function updateRakKeterangan(code, ketId, patch) {
    const row = getRakRow(code);
    updateRakRow(code, { keterangan: row.keterangan.map((k) => (k.id === ketId ? { ...k, ...patch } : k)) });
  }

  function removeRakKeterangan(code, ketId) {
    const row = getRakRow(code);
    updateRakRow(code, { keterangan: row.keterangan.filter((k) => k.id !== ketId) });
  }

  // Resolve batch for ONE row: manual pick wins, else auto if exactly one
  // valid SAP batch, else the last-used batch IF it's still a valid SAP
  // batch (never trust a stale batch that isn't even in Master Data).
  function resolveRowBatch(m) {
    const options = recountBatchOptions[m.material] || [];
    const row = getRakRow(m.material);
    if (row.batch) return options.find((o) => o.batch === row.batch) || null;
    if (options.length === 1) return options[0];
    if (m.lastBatch && options.some((o) => o.batch === m.lastBatch)) {
      return options.find((o) => o.batch === m.lastBatch);
    }
    return null;
  }

  // Bulk save semua baris yang terisi di satu rak sekaligus (recount only).
  async function handleSaveRak(rak, materials) {
    setRakError(null);
    const rowsToInsert = [];
    const touchedCodes = [];

    for (const m of materials) {
      const row = getRakRow(m.material);
      const hasQty = row.qtyFisik !== '' && row.qtyFisik !== null && row.qtyFisik !== undefined;
      const hasKeterangan = row.keterangan.some((k) => k.qty !== '' && k.qty !== null && k.qty !== undefined);
      if (!hasQty && !hasKeterangan) continue; // untouched row — skip silently

      if (!hasQty) {
        setRakError(`${m.material}: Qty Fisik wajib diisi.`);
        return;
      }
      const qtyNum = Number(row.qtyFisik);
      if (Number.isNaN(qtyNum) || qtyNum < 0) {
        setRakError(`${m.material}: Qty Fisik harus angka >= 0.`);
        return;
      }
      if (!row.level) {
        setRakError(`${m.material}: Level wajib dipilih.`);
        return;
      }
      const resolvedBatch = resolveRowBatch(m);
      // Batch is a free-text combobox now, not a locked dropdown — kalau
      // yang diketik tidak cocok dengan Master Data (resolvedBatch null),
      // tetap diterima apa adanya dan disimpan sebagai tidak ada di SAP
      // (sama prinsipnya dengan material/batch not-in-SAP di form manual).
      // Cuma wajib diisi sesuatu — tidak boleh kosong.
      const typedBatch = (row.batch !== undefined ? row.batch : (resolvedBatch?.batch || '')).trim();
      if (!typedBatch) {
        setRakError(`${m.material}: Batch wajib diisi.`);
        return;
      }

      touchedCodes.push(m.material);
      const base = {
        session_id: id,
        petugas_nama: petugas,
        material_code: m.material,
        material_description: resolvedBatch?.material_description || m.material_description || null,
        batch: resolvedBatch?.batch || typedBatch,
        plant: resolvedBatch?.plant || null,
        storage_location: resolvedBatch?.storage_location || null,
        nomor_rak: rak.startsWith('(') ? '' : rak,
        level: Number(row.level),
        base_uom: resolvedBatch?.base_uom || null,
        status_sap: resolvedBatch ? 'ditemukan' : 'tidak_ada_di_sap',
        recount_round: activeRecountRound,
      };
      rowsToInsert.push({ ...base, qty_fisik: qtyNum, keterangan_khusus: null, keterangan_catatan: null });
      for (const k of row.keterangan) {
        if (k.qty === '' || k.qty === null || k.qty === undefined) continue;
        const kQty = Number(k.qty);
        if (Number.isNaN(kQty) || kQty < 0) {
          setRakError(`${m.material} (${k.jenis}): Qty harus angka >= 0.`);
          return;
        }
        rowsToInsert.push({ ...base, qty_fisik: kQty, keterangan_khusus: k.jenis, keterangan_catatan: k.catatan?.trim() || null });
      }
    }

    if (rowsToInsert.length === 0) {
      setRakError('Isi minimal satu Qty Fisik sebelum menyimpan.');
      return;
    }

    setSavingRak(rak);
    const { error } = await supabase.from('so_entries').insert(rowsToInsert);
    setSavingRak(null);
    if (error) {
      setRakError(error.message);
      return;
    }

    const now = Date.now();
    setRakRowState((prev) => {
      const next = { ...prev };
      for (const code of touchedCodes) next[code] = { ...getRakRow(code), savedAt: now };
      return next;
    });
    setLastSaved({
      isRecount: true,
      summary: `${touchedCodes.length} material di Rak ${rak}`,
      qty_fisik: rowsToInsert.filter((r) => !r.keterangan_khusus).reduce((s, r) => s + r.qty_fisik, 0),
      keteranganCount: rowsToInsert.filter((r) => r.keterangan_khusus).length,
    });
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
    setVoidingHistoryKey(null);
    if (recountMode) {
      loadMaterialHistory(code);
    } else {
      setMaterialHistory([]);
    }
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
    setManualBatch('');
    setShowBatchSuggestions(false);
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

  // "Ganti batch" — clears the current pick so the combobox reopens for a
  // fresh search, instead of a separate select/manual mode toggle.
  function changeBatch() {
    setSelectedRow(null);
    setManualBatch('');
    setBatchNotFoundAttempt(null);
    setBatchConfirmedNotFound(false);
    setShowBatchSuggestions(true);
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
    if (statusSap === 'ditemukan' && batchOptions.length > 1 && !selectedRow) {
      if (!batchConfirmedNotFound) {
        setError(
          manualBatch.trim()
            ? 'Batch tidak ditemukan di Master Data. Cek lagi, lalu ketik ulang batch yang sama untuk konfirmasi.'
            : 'Pilih atau ketik Batch terlebih dahulu.'
        );
        return;
      }
      // confirmed not-found batch — allowed, falls through as
      // "Material/Batch tidak ada di Master Data"
    }
    if (!nomorRak.trim()) {
      setError('Nomor Rak wajib diisi.');
      return;
    }
    if (!level) {
      setError('Level wajib dipilih (1-7).');
      return;
    }

    // Qty Fisik is always required — Keterangan Khusus is optional metadata
    // on top of it, not a substitute for it.
    if (qtyFisik === '' || qtyFisik === null) {
      setError('Qty Fisik wajib diisi.');
      return;
    }
    {
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
          .is('voided_at', null)
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
    {
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
    const effectiveBatch = selectedRow?.batch || manualBatch.trim() || null;

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

  const needsBatchPicker = lookupState === 'found' && statusSap === 'ditemukan' && batchOptions.length > 1 && !selectedRow;
  const filteredBatchOptions = needsBatchPicker
    ? batchOptions.filter((r) => r.batch?.toLowerCase().includes(manualBatch.trim().toLowerCase()))
    : [];
  // The "batch not matched" case has its own inline message right under the
  // combobox (with the recheck/confirm copy) — this block only covers
  // "found row" details and the "material entirely unknown" case, so the
  // two messages never show at once and contradict each other.
  const showDetails = !!selectedRow || (lookupState === 'notfound' && materialConfirmedNotFound);

  const filteredRecountSuggestions = recountMode
    ? normalRecountMaterials.filter((m) => m.toLowerCase().includes(materialCode.trim().toLowerCase())).slice(0, 8)
    : [];

  // Rak codes dari Warehouse Racks (upload yang sudah ada) — suggestion
  // buat combobox Nomor Rak, bukan penentu material.
  const filteredRakSuggestions = warehouseRackCodes
    .filter((r) => r.toLowerCase().includes(nomorRak.trim().toLowerCase()))
    .slice(0, 8);

  // Renderer buat rak-accordion recount — dikelompokkan dari histori entry
  // tim lapangan (loadRecountRakGroups), termasuk panel self-void "Riwayat
  // & batalkan" per material.
  function renderRakAccordion(groups) {
    const term = rakSearch.trim().toLowerCase();
    const filteredGroups = term ? groups.filter((g) => g.rak.toLowerCase().includes(term)) : groups;
    return (
      <div className="space-y-1.5">
        {groups.length > 5 && (
          <input
            className="input-field"
            value={rakSearch}
            onChange={(e) => setRakSearch(e.target.value)}
            placeholder="Cari rak..."
          />
        )}
        {filteredGroups.length === 0 && (
          <div className="p-3 text-center text-xs text-ink/40">Tidak ada rak yang cocok.</div>
        )}
        {filteredGroups.map((g) => {
          const isOpen = openRak === g.rak;
          const filledCount = g.materials.filter((m) => getRakRow(m.material).savedAt).length;
          return (
            <div key={g.rak} className="overflow-hidden rounded-lg border border-line bg-white">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left"
                onClick={() => setOpenRak(isOpen ? null : g.rak)}
              >
                <span className="font-mono text-sm font-semibold text-ink">Rak {g.rak}</span>
                <span className="flex items-center gap-1.5 text-xs text-ink/50">
                  {filledCount > 0 && <span className="badge bg-good/10 text-good">{filledCount} tersimpan</span>}
                  {g.materials.length} material
                  <span>{isOpen ? '▲' : '▼'}</span>
                </span>
              </button>
              {isOpen && (
                <div className="space-y-2.5 border-t border-line p-2.5">
                  {g.materials.map((m) => {
                    const row = getRakRow(m.material);
                    const batchOptions = recountBatchOptions[m.material] || [];
                    const resolvedBatch = resolveRowBatch(m);
                    return (
                      <div key={m.material} className={`rounded-lg border p-2.5 text-sm ${row.savedAt ? 'border-good/30 bg-good/5' : 'border-line bg-white'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-mono text-sm font-medium text-ink">{m.material}</div>
                            {m.material_description && <div className="text-xs text-ink/50">{m.material_description}</div>}
                          </div>
                          {row.savedAt && <span className="badge bg-good/10 text-good shrink-0">✓ Tersimpan</span>}
                        </div>

                        <div className="relative mt-2">
                          <label className="label-field text-xs">Batch</label>
                          <input
                            className="input-field font-mono"
                            value={row.batch !== undefined ? row.batch : (resolvedBatch?.batch || '')}
                            onChange={(e) => updateRakRow(m.material, { batch: e.target.value })}
                            onFocus={() => setBatchSuggestFor(m.material)}
                            onBlur={() => setTimeout(() => setBatchSuggestFor((f) => (f === m.material ? null : f)), 150)}
                            placeholder={batchOptions.length === 0 ? 'Tidak ada di SAP — ketik manual' : 'Ketik untuk cari batch...'}
                            autoComplete="off"
                          />
                          {batchSuggestFor === m.material && batchOptions.length > 0 && (() => {
                            const typed = (row.batch !== undefined ? row.batch : '').trim().toLowerCase();
                            const matches = typed ? batchOptions.filter((o) => o.batch.toLowerCase().includes(typed)) : batchOptions;
                            return matches.length > 0 && (
                              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">
                                {matches.map((o) => (
                                  <li key={o.batch}>
                                    <button
                                      type="button"
                                      className="block w-full px-3 py-2 text-left font-mono text-sm hover:bg-paper"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        updateRakRow(m.material, { batch: o.batch });
                                        setBatchSuggestFor(null);
                                      }}
                                    >
                                      {o.batch}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            );
                          })()}
                          {row.batch !== undefined && row.batch.trim() && !resolvedBatch && (
                            <div className="mt-1 text-xs text-warn">
                              Batch "{row.batch.trim()}" tidak ditemukan di Master Data — akan disimpan sebagai tidak ada di SAP.
                            </div>
                          )}
                          {m.lastBatch && resolvedBatch && resolvedBatch.batch !== m.lastBatch && (
                            <div className="mt-1 text-xs text-warn">Batch lama tidak cocok (sebelumnya {m.lastBatch})</div>
                          )}
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <label className="label-field text-xs">Level</label>
                            <select
                              className="input-field"
                              value={row.level}
                              onChange={(e) => updateRakRow(m.material, { level: e.target.value === '' ? '' : Number(e.target.value) })}
                            >
                              <option value="" disabled>Pilih...</option>
                              {LEVELS.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="label-field text-xs">Qty Fisik{resolvedBatch?.base_uom ? ` (${resolvedBatch.base_uom})` : ''}</label>
                            <input
                              className="input-field"
                              type="number"
                              min="0"
                              value={row.qtyFisik}
                              onChange={(e) => updateRakRow(m.material, { qtyFisik: e.target.value })}
                              placeholder="0"
                            />
                          </div>
                        </div>

                        {row.keterangan.map((k) => (
                          <div key={k.id} className="mt-2 rounded-lg bg-paper p-2">
                            <div className="grid items-center gap-2" style={{ gridTemplateColumns: '1fr 4.5rem auto' }}>
                              <select
                                className="input-field w-full"
                                value={k.jenis}
                                onChange={(e) => updateRakKeterangan(m.material, k.id, { jenis: e.target.value })}
                              >
                                {KETERANGAN_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                              <input
                                className="input-field w-full"
                                type="number"
                                min="0"
                                value={k.qty}
                                onChange={(e) => updateRakKeterangan(m.material, k.id, { qty: e.target.value })}
                                placeholder="Qty"
                              />
                              <button type="button" onClick={() => removeRakKeterangan(m.material, k.id)} className="shrink-0 text-ink/30 hover:text-bad">✕</button>
                            </div>
                            {k.jenis === 'Lainnya' && (
                              <input
                                className="input-field mt-2"
                                value={k.catatan}
                                onChange={(e) => updateRakKeterangan(m.material, k.id, { catatan: e.target.value })}
                                placeholder="Jelaskan kondisi..."
                              />
                            )}
                          </div>
                        ))}
                        <button type="button" onClick={() => addRakKeterangan(m.material)} className="mt-2 text-xs font-medium text-slate-850 hover:underline">
                          + Tambah Keterangan Khusus
                        </button>

                        <div className="mt-2 border-t border-line pt-2">
                          <button type="button" onClick={() => toggleRowHistory(m.material)} className="text-xs font-medium text-slate-850 hover:underline">
                            {openHistoryFor === m.material ? 'Tutup riwayat' : 'Riwayat & batalkan →'}
                          </button>
                          {openHistoryFor === m.material && (
                            <div className="mt-2 space-y-2 rounded-lg border border-warn/30 bg-warn/5 p-2 text-xs">
                              <p className="text-ink/50">
                                Kalau entry lama rak/batch-nya salah, tekan "Batalkan" — otomatis dibatalkan dan
                                form di atas terisi ulang dari data lama itu, tinggal koreksi field yang salah
                                lalu Simpan Rak lagi.
                              </p>
                              {loadingHistoryFor === m.material ? (
                                <div className="text-ink/40">Memuat...</div>
                              ) : (historyByMaterial[m.material] || []).length === 0 ? (
                                <div className="text-ink/40">Belum ada entry sebelumnya.</div>
                              ) : (
                                (historyByMaterial[m.material] || []).map((h) => {
                                  const hKey = `${h.source}:${h.id}`;
                                  return (
                                    <div key={hKey} className="rounded-lg border border-line bg-white p-2">
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
                                          <button type="button" onClick={() => startHistoryVoid(h)} className="btn-ghost shrink-0 text-xs text-bad">
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
                                            onChange={(e) => setHistoryVoidReason(e.target.value)}
                                            placeholder="Alasan: contoh salah batch, seharusnya S075A"
                                            autoFocus
                                          />
                                          <div className="flex gap-2">
                                            <button
                                              type="button"
                                              disabled={savingHistoryVoid}
                                              onClick={() => confirmRowHistoryVoid(m.material, h)}
                                              className="inline-flex items-center justify-center rounded-lg bg-bad px-3 py-1.5 text-xs font-medium text-white transition hover:bg-bad/90 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
                                            >
                                              {savingHistoryVoid ? 'Menyimpan...' : 'Batalkan & Isi Ulang'}
                                            </button>
                                            <button type="button" onClick={() => setVoidingHistoryKey(null)} className="btn-ghost text-xs">Batal</button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {rakError && <div className="text-xs text-bad">{rakError}</div>}

                  <button
                    type="button"
                    onClick={() => handleSaveRak(g.rak, g.materials)}
                    disabled={savingRak === g.rak}
                    className="btn-amber w-full"
                  >
                    {savingRak === g.rak ? 'Menyimpan...' : `Simpan Rak ${g.rak}`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

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

          {recountRakGroups.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="text-xs font-medium text-ink/60">Pilih rak untuk mulai:</div>
              {renderRakAccordion(recountRakGroups)}
            </div>
          )}
          <Link href={`/sessions/${id}/selisih`} className="mt-2 inline-block text-xs font-medium text-slate-850 hover:underline">
            Lihat rak &amp; siapa yang terakhir hitung di Rak Selisih →
          </Link>
        </div>
      )}

      {lastSaved && (
        <div className={`card p-3 text-sm ${lastSaved.isRecount ? 'border-warn/30 bg-warn/5 text-warn' : 'border-good/30 bg-good/5 text-good'}`}>
          {lastSaved.isRecount && '🔄 '}
          {lastSaved.summary ? (
            <>Tersimpan: {lastSaved.summary}{lastSaved.qty_fisik > 0 && ` · Total Qty ${lastSaved.qty_fisik}`}{lastSaved.keteranganCount > 0 && ` · ${lastSaved.keteranganCount} Keterangan Khusus`}</>
          ) : (
            <>
              Tersimpan: {lastSaved.material_code} · Rak {lastSaved.nomor_rak} (Lv {lastSaved.level})
              {lastSaved.qty_fisik > 0 && ` · Qty ${lastSaved.qty_fisik}${lastSaved.base_uom ? ` ${lastSaved.base_uom}` : ''}`}
              {lastSaved.keteranganCount > 0 && ` · ${lastSaved.keteranganCount} Keterangan Khusus`}
            </>
          )}
        </div>
      )}

      {!recountMode && (
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

        {needsBatchPicker && (
          <div className="relative">
            <label className="label-field">Batch</label>
            <input
              className="input-field font-mono"
              value={manualBatch}
              onChange={(e) => {
                setManualBatch(e.target.value);
                setShowBatchSuggestions(true);
                setBatchConfirmedNotFound(false);
              }}
              onFocus={() => setShowBatchSuggestions(true)}
              onBlur={() => {
                setTimeout(() => setShowBatchSuggestions(false), 150);
                confirmManualBatch();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setShowBatchSuggestions(false);
                  confirmManualBatch();
                }
              }}
              placeholder="Ketik untuk cari batch..."
              autoComplete="off"
            />
            {showBatchSuggestions && filteredBatchOptions.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">
                {filteredBatchOptions.map((r) => (
                  <li key={r.batch}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-paper"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setManualBatch(r.batch);
                        handleBatchSelect(r.batch);
                        setShowBatchSuggestions(false);
                      }}
                    >
                      <span className="font-mono font-medium">{r.batch}</span>
                      <span className="ml-1.5 text-ink/50">— {r.storage_location}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {manualBatch.trim() && !selectedRow && !showBatchSuggestions && (
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
                <button type="button" onClick={changeBatch} className="justify-self-start text-xs font-medium text-slate-850 hover:underline">
                  Bukan batch ini? Ganti batch →
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
          <div className="relative">
            <label className="label-field">Nomor Rak</label>
            <input
              ref={nomorRakRef}
              className="input-field"
              value={nomorRak}
              onChange={(e) => {
                setNomorRak(e.target.value);
                setShowRakSuggestions(true);
              }}
              onFocus={() => setShowRakSuggestions(true)}
              onBlur={() => setTimeout(() => setShowRakSuggestions(false), 150)}
              placeholder="Ketik atau cari rak..."
              autoComplete="off"
            />
            {showRakSuggestions && filteredRakSuggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">
                {filteredRakSuggestions.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left font-mono text-sm hover:bg-paper"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setNomorRak(r);
                        setShowRakSuggestions(false);
                      }}
                    >
                      {r}
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
              {/* Explicit grid track widths instead of flex-grow — a flex
                  row here kept letting the <select> collapse to just its
                  arrow regardless of flex-1/min-w-0, because native <select>
                  intrinsic sizing fights the flex algorithm on some
                  browsers. Grid tracks are a hard pixel contract the browser
                  can't renegotiate away. */}
              <div className="grid items-center gap-2" style={{ gridTemplateColumns: '1fr 4.5rem auto' }}>
                <select
                  className="input-field w-full"
                  value={k.jenis}
                  onChange={(e) => updateKeterangan(k.id, { jenis: e.target.value })}
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
      )}

      {!recountMode && showNotFoundModal && (
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
