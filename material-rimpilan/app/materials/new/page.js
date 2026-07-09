'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { PLANTS } from '../../../lib/plants';

export default function NewMaterialPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    kode_material: '',
    nama_material: '',
    satuan: '',
    plant: PLANTS[0],
    nomor_rak: '',
    batch: '',
    keterangan: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.kode_material.trim() || !form.satuan.trim()) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase.from('mr_materials').insert({
      kode_material: form.kode_material.trim(),
      nama_material: form.nama_material.trim() || form.kode_material.trim(),
      satuan: form.satuan.trim(),
      plant: form.plant,
      nomor_rak: form.nomor_rak.trim() || null,
      batch: form.batch.trim() || null,
      keterangan: form.keterangan.trim() || null,
    });
    setSaving(false);
    if (error) {
      setError(error.message.includes('duplicate') ? 'Kode Material ini sudah ada di RDC yang sama.' : error.message);
      return;
    }
    router.push('/materials');
  }

  return (
    <div className="mx-auto max-w-md">
      <Link href="/materials" className="text-xs text-ink/50 hover:text-ink">← Master Material</Link>
      <h1 className="mb-6 mt-1 text-xl font-semibold tracking-tight">Tambah Material</h1>
      <form onSubmit={handleSubmit} className="card space-y-4 p-5">
        <div>
          <label className="label-field">RDC</label>
          <select className="input-field" value={form.plant} onChange={(e) => update('plant', e.target.value)}>
            {PLANTS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-field">Kode Material</label>
          <input className="input-field font-mono" value={form.kode_material} onChange={(e) => update('kode_material', e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label-field">Nama Material (Opsional)</label>
          <input className="input-field" value={form.nama_material} onChange={(e) => update('nama_material', e.target.value)} placeholder="Diisi otomatis dari Kode Material kalau kosong" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-field">Satuan</label>
            <input className="input-field" value={form.satuan} onChange={(e) => update('satuan', e.target.value)} placeholder="pcs, kg, dus..." />
          </div>
          <div>
            <label className="label-field">Nomor Rak</label>
            <input className="input-field font-mono" value={form.nomor_rak} onChange={(e) => update('nomor_rak', e.target.value)} placeholder="A-01-01" />
          </div>
        </div>
        <div>
          <label className="label-field">Batch (Opsional)</label>
          <input className="input-field font-mono" value={form.batch} onChange={(e) => update('batch', e.target.value)} />
        </div>
        <div>
          <label className="label-field">Keterangan (Opsional)</label>
          <textarea className="input-field" rows={2} value={form.keterangan} onChange={(e) => update('keterangan', e.target.value)} />
        </div>
        {error && <div className="text-sm text-bad">{error}</div>}
        <button type="submit" className="btn-teal w-full" disabled={saving}>
          {saving ? 'Menyimpan...' : 'Simpan Material'}
        </button>
      </form>
    </div>
  );
}
