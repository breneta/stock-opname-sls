'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

export default function StartPage() {
  const { id } = useParams();
  const router = useRouter();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const savedName = localStorage.getItem(`so_petugas_${id}`);
    if (savedName) {
      setName(savedName);
      setSaved(true);
    }
  }, [id]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    localStorage.setItem(`so_petugas_${id}`, name.trim());
    setSaved(true);
  }

  function goTo(path) {
    if (!name.trim()) return;
    localStorage.setItem(`so_petugas_${id}`, name.trim());
    router.push(path);
  }

  return (
    <div className="mx-auto max-w-md">
      <Link href="/mulai" className="text-xs text-ink/50 hover:text-ink">← Pilih Session</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold tracking-tight">Mulai Stock Opname</h1>
      <p className="mb-6 text-sm text-ink/60">
        Nama petugas akan otomatis tersimpan pada seluruh input selama session ini — baik untuk
        Input Normal maupun Input Rimpilan.
      </p>

      <form onSubmit={handleSubmit} className="card space-y-4 p-5">
        <div>
          <label className="label-field">Nama Petugas</label>
          <input
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: Andi"
            autoFocus
          />
        </div>
        {!saved && (
          <button type="submit" className="btn-ghost w-full" disabled={!name.trim()}>
            Simpan Nama
          </button>
        )}
      </form>

      {(saved || name.trim()) && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Pilih Jenis Input</p>
          <button onClick={() => goTo(`/sessions/${id}/input`)} className="card block w-full p-4 text-left transition hover:border-amber/60 hover:shadow-md">
            <div className="font-medium text-ink">Input Normal SO</div>
            <div className="mt-0.5 text-sm text-ink/50">Cari material satu per satu, lalu input Qty Fisik</div>
          </button>
          <button onClick={() => goTo(`/sessions/${id}/rimpilan/input`)} className="card block w-full p-4 text-left transition hover:border-amber/60 hover:shadow-md">
            <div className="font-medium text-ink">Input Rimpilan</div>
            <div className="mt-0.5 text-sm text-ink/50">Pilih warehouse → rak, lalu input per rak (accordion)</div>
          </button>
        </div>
      )}
    </div>
  );
}
