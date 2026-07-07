'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function TransaksiForm({ tipe, onSaved }) {
  const [materials, setMaterials] = useState([]);
  const [materialId, setMaterialId] = useState('');
  const [tanggal, setTanggal] = useState(() => new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.from('mr_materials').select('*').order('nama_material').then(({ data }) => setMaterials(data || []));
  }, []);

  const selected = materials.find((m) => m.id === materialId);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!materialId) return setError('Pilih material.');
    const qtyNum = Number(qty);
    if (qty === '' || Number.isNaN(qtyNum) || qtyNum <= 0) return setError('Qty harus angka lebih dari 0.');
    if (tipe === 'keluar' && selected && qtyNum > Number(selected.stok)) {
      return setError(`Stok tidak mencukupi. Stok saat ini: ${selected.stok} ${selected.satuan}.`);
    }

    setSaving(true);
    const { error } = await supabase.from('mr_transaksi').insert({
      material_id: materialId,
      tipe,
      tanggal,
      qty: qtyNum,
      keterangan: keterangan.trim() || null,
    });
    setSaving(false);
    if (error) return setError(error.message);

    setQty('');
    setKeterangan('');
    onSaved?.();
    // refresh material list so stok shown is current
    supabase.from('mr_materials').select('*').order('nama_material').then(({ data }) => setMaterials(data || []));
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-5">
      <div>
        <label className="label-field">Tanggal</label>
        <input type="date" className="input-field" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
      </div>
      <div>
        <label className="label-field">Kode Material</label>
        <select className="input-field" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
          <option value="">Pilih material...</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.kode_material} — {m.nama_material} (stok: {m.stok} {m.satuan})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label-field">Qty {selected ? `(${selected.satuan})` : ''}</label>
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
