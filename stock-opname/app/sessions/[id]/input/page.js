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

  const [materialCode, setMaterialCode] = useState('');
  const [lookupState, setLookupState] = useState('idle'); // idle | searching | found | notfound
  const [batchOptions, setBatchOptions] = useState([]); // sap rows sharing the material code
  const [selectedRow, setSelectedRow] = useState(null); // chosen sap row (or null if not-in-SAP)
  const [showNotFoundModal, setShowNotFoundModal] = useState(false);
  const [statusSap, setStatusSap] = useState('ditemukan');

  const [nomorRak, setNomorRak] = useState('');
  const [qtyFisik, setQtyFisik] = useState('');
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
  }, [id, router]);

  async function handleMaterialKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = materialCode.trim();
    if (!code) return;

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
    setKondisiBarang('Normal');
    setCatatan('');
    setTimeout(() => materialInputRef.current?.focus(), 50);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError(null);

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
      kondisi_barang: kondisiBarang,
      catatan: catatan.trim() || null,
      status_sap: statusSap,
    };

    const { error } = await supabase.from('so_entries').insert(record);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setLastSaved(record);
    resetForm();
  }

  const showBatchPicker = lookupState === 'found' && batchOptions.length > 1 && !selectedRow;
  const showDetails = selectedRow || statusSap === 'tidak_ada_di_sap';

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/sessions/${id}`} className="text-xs text-ink/50 hover:text-ink">← Dashboard</Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Input Stock Opname</h1>
        </div>
        <div className="badge bg-slate-850/10 text-ink">{petugas}</div>
      </div>

      {lastSaved && (
        <div className="card border-good/30 bg-good/5 p-3 text-sm text-good">
          Tersimpan: {lastSaved.material_code} · Rak {lastSaved.nomor_rak} · Qty {lastSaved.qty_fisik}
        </div>
      )}

      <form onSubmit={handleSave} className="card space-y-4 p-5">
        <div>
          <label className="label-field">Material Code</label>
          <input
            ref={materialInputRef}
            className="input-field font-mono"
            value={materialCode}
            onChange={(e) => setMaterialCode(e.target.value)}
            onKeyDown={handleMaterialKeyDown}
            placeholder="Ketik atau scan, lalu Enter"
            autoFocus
          />
          {lookupState === 'searching' && (
            <div className="mt-1.5 text-xs text-ink/50">Mencari...</div>
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
              </div>
            ) : (
              <div className="text-warn">
                Material "{materialCode}" — Tidak Ada di SAP. Data akan tetap disimpan.
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
            <label className="label-field">Qty Fisik</label>
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
