'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { PLANTS } from '../lib/plants';

export default function TransaksiForm({ tipe, onSaved }) {
  const codeInputRef = useRef(null);

  const [plant, setPlant] = useState(PLANTS[0]);
  const [tanggal, setTanggal] = useState(() => new Date().toISOString().slice(0, 10));
  const [kodeMaterial, setKodeMaterial] = useState('');
  const [lookupState, setLookupState] = useState('idle'); // idle | searching | found | notfound
  const [material, setMaterial] = useState(null);
  const [qty, setQty] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem('mr_last_plant');
    if (saved && PLANTS.includes(saved)) setPlant(saved);
  }, []);

  function handlePlantChange(value) {
    setPlant(value);
    localStorage.setItem('mr_last_plant', value);
    resetLookup();
  }

  function resetLookup() {
    setKodeMaterial('');
    setLookupState('idle');
    setMaterial(null);
  }

  async function handleCodeKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = kodeMaterial.trim();
    if (!code) return;

    setLookupState('searching');
    setError(null);
    const { data, error } = await supabase
      .from('mr_materials')
      .select('*')
      .eq('plant', plant)
      .ilike('kode_material', code)
      .maybeSingle();

    if (error) {
      setError(error.message);
      setLookupState('idle');
      return;
    }
    if (!data) {
      setMaterial(null);
      setLookupState('notfound');
      return;
    }
    if (tipe === 'keluar' && Number(data.stok) <= 0) {
      setError(`Stok "${data.nama_material}" di ${plant} sudah 0.`);
    }
    setMaterial(data);
    setLookupState('found');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!material) return setError('Cari Kode Material terlebih dahulu (tekan Enter).');
    const qtyNum = Number(qty);
    if (qty === '' || Number.isNaN(qtyNum) || qtyNum <= 0) return setError('Qty harus angka lebih dari 0.');
    if (tipe === 'keluar' && qtyNum > Number(material.stok)) {
      return setError(`Stok tidak mencukupi. Stok saat ini: ${material.stok} ${material.satuan}.`);
    }

    setSaving(true);
    const { error } = await supabase.from('mr_transaksi').insert({
      material_id: material.id,
      tipe,
      tanggal,
      qty: qtyNum,
      keterangan: keterangan.trim() || null,
    });
    setSaving(false);
    if (error) return setError(error.message);

    setQty('');
    setKeterangan('');
    resetLookup();
    setTimeout(() => codeInputRef.current?.focus(), 50);
    onSaved?.();
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-field">RDC</label>
          <select className="input-field" value={plant} onChange={(e) => handlePlantChange(e.target.value)}>
            {PLANTS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-field">Tanggal</label>
          <input type="date" className="input-field" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label-field">Kode Material</label>
        <input
          ref={codeInputRef}
          className="input-field font-mono"
          value={kodeMaterial}
          onChange={(e) => setKodeMaterial(e.target.value)}
          onKeyDown={handleCodeKeyDown}
          placeholder="Ketik atau scan, lalu Enter"
        />
        {lookupState === 'searching' && <div className="mt-1.5 text-xs text-ink/50">Mencari...</div>}
      </div>

      {lookupState === 'notfound' && (
        <div className="rounded-lg bg-warn/10 p-3.5 text-sm text-warn">
          Material "{kodeMaterial}" tidak ditemukan di {plant}.{' '}
          <Link href="/materials/new" className="font-medium underline">Tambah material ini</Link> dulu.
        </div>
      )}

      {material && (
        <div className="rounded-lg bg-paper p-3.5 text-sm">
          <div className="grid grid-cols-2 gap-y-1.5">
            <span className="text-ink/50">Nama</span>
            <span>{material.nama_material}</span>
            <span className="text-ink/50">Nomor Rak</span>
            <span className="font-mono">{material.nomor_rak || '—'}</span>
            <span className="text-ink/50">Satuan</span>
            <span>{material.satuan}</span>
            <span className="text-ink/50">Stok Saat Ini</span>
            <span className="font-mono">{material.stok} {material.satuan}</span>
          </div>
        </div>
      )}

      <div>
        <label className="label-field">Qty {material ? `(${material.satuan})` : ''}</label>
        <input type="number" min="0" className="input-field" value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
      <div>
        <label className="label-field">Keterangan</label>
        <textarea className="input-field" rows={2} value={keterangan} onChange={(e) => setKeterangan(e.target.value)} />
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}
      <button type="submit" className={tipe === 'masuk' ? 'btn-teal w-full' : 'btn-primary w-full'} disabled={saving}>
        {saving ? 'Menyimpan...' : tipe === 'masuk' ? 'Simpan Barang Masuk' : 'Simpan Barang Keluar'}
      </button>
    </form>
  );
}
