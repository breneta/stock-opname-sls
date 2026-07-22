'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';

const KONDISI_OPTIONS = ['Normal', 'Pecah', 'Gumpil', 'Pecah & Gumpil'];

export default function InputPage() {
  const { id } = useParams();
  const router = useRouter();

  const [petugas, setPetugas] = useState('');
  const materialInputRef = useRef(null);
  const nomorRakRef = useRef(null);

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

  // Only materials whose source is 'normal' are actionable on THIS page —
  // rimpilan-only codes would hit "Tidak Ada di SAP" here since they
  // typically don't live in so_sap_data, which is confusing. They're
  // surfaced instead as a pointer to the Rimpilan input page.
  const normalRecountMaterials = recountMaterials.filter((c) => recountSources[c] !== 'rimpilan');
  const rimpilanOnlyRecountMaterials = recountMaterials.filter((c) => recountSources[c] === 'rimpilan');

  const [materialCode, setMaterialCode] = useState('');
  const [showRecountSuggestions, setShowRecountSuggestions] = useState(false);
  const [lookupState, setLookupState] = useState('idle'); // idle | searching | found | notfound
  const [batchOptions, setBatchOptions] = useState([]); // sap rows sharing the material code
  const [selectedRow, setSelectedRow] = useState(null); // chosen sap row (or null if not-in-SAP)
  const [showNotFoundModal, setShowNotFoundModal] = useState(false);
  const [statusSap, setStatusSap] = useState('ditemukan');

  const [nomorRak, setNomorRak] = useState('');
  const [qtyFisik, setQtyFisik] = useState('');
  const [manualUom, setManualUom] = useState(''); // only used when material isn't in SAP
  const [uomOptions, setUomOptions] = useState([]);
  const [kondisiBarang, setKondisiBarang] = useState('Normal');
  const [catatan, setCatatan] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);

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
  }, [id, router]);

  async function loadSessionRecountState() {
    const { data } = await supabase
      .from('so_sessions')
      .select('active_recount_round, recount_material_codes')
      .eq('id', id)
      .single();
    if (data) {
      setActiveRecountRound(data.active_recount_round || 0);
      const codes = data.recount_material_codes || [];
      // recount_material_codes is an array of { code, source } objects —
      // source lets us split "recount here" vs "recount on the Rimpilan
      // page" without a second query.
      if (codes.length > 0 && typeof codes[0] === 'object') {
        setRecountMaterials(codes.map((c) => c.code));
        setRecountSources(Object.fromEntries(codes.map((c) => [c.code, c.source || 'normal'])));
      } else {
        setRecountMaterials(codes);
        setRecountSources(Object.fromEntries(codes.map((c) => [c, 'normal'])));
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
      setLookupState('notfound');
      setStatusSap('tidak_ada_di_sap');
      setShowNotFoundModal(true);
      return;
    }

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

  function handleBatchSelect(batch) {
    const row = batchOptions.find((r) => r.batch === batch);
    setSelectedRow(row || null);
    if (row) focusNomorRak();
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

  function resetForm() {
    setMaterialCode('');
    setLookupState('idle');
    setBatchOptions([]);
    setSelectedRow(null);
    setStatusSap('ditemukan');
    setNomorRak('');
    setQtyFisik('');
    setManualUom('');
    setKondisiBarang('Normal');
    setCatatan('');
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
    if (lookupState !== 'found' && statusSap !== 'tidak_ada_di_sap') {
      setError('Cari Material Code terlebih dahulu (tekan Enter).');
      return;
    }
    if (batchOptions.length > 1 && !selectedRow && statusSap !== 'tidak_ada_di_sap') {
      setError('Pilih Batch terlebih dahulu.');
      return;
    }
    if (!nomorRak.trim()) {
      setError('Nomor Rak wajib diisi.');
      return;
    }
    const qtyNum = Number(qtyFisik);
    if (qtyFisik === '' || Number.isNaN(qtyNum)) {
      setError('Qty Fisik harus berupa angka.');
      return;
    }
    if (qtyNum < 0) {
      setError('Qty Fisik tidak boleh negatif.');
      return;
    }
    if (kondisiBarang !== 'Normal' && !catatan.trim()) {
      setError('Catatan wajib diisi jika Kondisi Barang bukan Normal.');
      return;
    }

    setSaving(true);
    const record = {
      session_id: id,
      petugas_nama: petugas,
      material_code: materialCode.trim(),
      material_description: selectedRow?.material_description || null,
      batch: selectedRow?.batch || null,
      plant: selectedRow?.plant || null,
      storage_location: selectedRow?.storage_location || null,
      nomor_rak: nomorRak.trim(),
      qty_fisik: qtyNum,
      base_uom: selectedRow?.base_uom || manualUom.trim() || null,
      kondisi_barang: kondisiBarang,
      catatan: catatan.trim() || null,
      status_sap: statusSap,
      // Di-stamp otomatis dari session — petugas tidak perlu tahu/pilih
      // round-nya, Accounting yang mengontrol lewat tombol "Mulai Recount".
      recount_round: recountMode ? activeRecountRound : 0,
    };

    const { error } = await supabase.from('so_entries').insert(record);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setLastSaved({ ...record, isRecount: recountMode });
    resetForm();
  }

  const showBatchPicker = lookupState === 'found' && batchOptions.length > 1 && !selectedRow;
  const showDetails = selectedRow || statusSap === 'tidak_ada_di_sap';

  const filteredRecountSuggestions = recountMode
    ? normalRecountMaterials.filter((m) => m.toLowerCase().includes(materialCode.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/mulai" className="text-xs text-ink/50 hover:text-ink">← Pilih Session</Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Input Stock Opname</h1>
        </div>
        <div className="badge bg-slate-850/10 text-ink">{petugas}</div>
      </div>

      <Link
        href={`/sessions/${id}/rimpilan/input`}
        className="card block p-3.5 text-sm transition hover:border-amber/60 hover:shadow-md"
      >
        <span className="font-medium text-ink">Input Rimpilan →</span>
        <span className="ml-2 text-ink/50">Untuk material yang dihitung per-rak, bukan satu-satu</span>
      </Link>

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
        </div>
      )}

      {lastSaved && (
        <div className={`card p-3 text-sm ${lastSaved.isRecount ? 'border-warn/30 bg-warn/5 text-warn' : 'border-good/30 bg-good/5 text-good'}`}>
          {lastSaved.isRecount && '🔄 '}Tersimpan: {lastSaved.material_code} · Rak {lastSaved.nomor_rak} · Qty {lastSaved.qty_fisik}{lastSaved.base_uom ? ` ${lastSaved.base_uom}` : ''}
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
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-warn">
                  Material "{materialCode}" — Tidak Ada di SAP. Data akan tetap disimpan.
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

        <div>
          <label className="label-field">Kondisi Barang</label>
          <select
            className="input-field"
            value={kondisiBarang}
            onChange={(e) => setKondisiBarang(e.target.value)}
          >
            {KONDISI_OPTIONS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        {kondisiBarang !== 'Normal' && (
          <div>
            <label className="label-field">Catatan (wajib)</label>
            <textarea
              className="input-field"
              rows={2}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Jelaskan kondisi barang..."
            />
          </div>
        )}

        {error && <div className="text-sm text-bad">{error}</div>}

        <button type="submit" className="btn-amber w-full" disabled={saving}>
          {saving ? 'Menyimpan...' : 'Simpan & Input Berikutnya'}
        </button>
      </form>

      {showNotFoundModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg">
            <div className="font-medium">Material tidak ditemukan pada Data SAP.</div>
            <p className="mt-2 text-sm text-ink/60">Kemungkinan penyebab:</p>
            <ul className="mt-1 list-inside list-disc text-sm text-ink/60">
              <li>Material baru belum ada pada Data SAP.</li>
              <li>Salah input Material Code.</li>
              <li>Data SAP belum diperbarui.</li>
            </ul>
            <p className="mt-3 text-sm font-medium">Apakah Anda yakin ingin tetap menyimpan data ini?</p>
            <div className="mt-4 flex gap-2">
              <button onClick={handleNotFoundKembali} className="btn-ghost flex-1">Kembali</button>
              <button onClick={handleNotFoundTetapSimpan} className="btn-primary flex-1">Tetap Simpan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
