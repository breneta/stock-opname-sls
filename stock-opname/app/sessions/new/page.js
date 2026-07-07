'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

export default function NewSessionPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const { data, error } = await supabase
      .from('so_sessions')
      .insert({ name: name.trim() })
      .select()
      .single();
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(`/sessions/${data.id}`);
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Session Baru</h1>
      <p className="mb-6 text-sm text-ink/60">
        Contoh nama: "Stock Opname RDC Jakarta - Juli 2026"
      </p>
      <form onSubmit={handleSubmit} className="card space-y-4 p-5">
        <div>
          <label className="label-field">Nama Session</label>
          <input
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Stock Opname RDC Jakarta - Juli 2026"
            autoFocus
          />
        </div>
        {error && <div className="text-sm text-bad">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={saving || !name.trim()}>
          {saving ? 'Menyimpan...' : 'Buat Session'}
        </button>
      </form>
    </div>
  );
}
