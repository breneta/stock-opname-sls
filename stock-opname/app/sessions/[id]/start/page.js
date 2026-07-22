'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

export default function StartPage() {
  const { id } = useParams();
  const router = useRouter();
  const [name, setName] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(`so_petugas_${id}`);
    if (saved) setName(saved);
  }, [id]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    localStorage.setItem(`so_petugas_${id}`, name.trim());
    router.push(`/sessions/${id}/input`);
  }

  return (
    <div className="mx-auto max-w-md">
      <Link href="/mulai" className="text-xs text-ink/50 hover:text-ink">← Pilih Session</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold tracking-tight">Mulai Stock Opname</h1>
      <p className="mb-6 text-sm text-ink/60">
        Nama petugas akan otomatis tersimpan pada seluruh input selama session ini.
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
        <button type="submit" className="btn-amber w-full" disabled={!name.trim()}>
          Mulai Stock Opname
        </button>
      </form>
    </div>
  );
}
