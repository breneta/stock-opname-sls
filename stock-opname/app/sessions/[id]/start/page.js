'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';

export default function StartPage() {
  const { id } = useParams();
  const router = useRouter();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  // Petugas could otherwise keep counting into a session Accounting has
  // already closed — the entry pages had no idea the session was closed at
  // all. Checked here (the entry point) AND on each input page directly,
  // since a petugas with a saved name in localStorage can deep-link straight
  // past Start.
  const [sessionStatus, setSessionStatus] = useState(null);
  const [sessionName, setSessionName] = useState('');

  useEffect(() => {
    const savedName = localStorage.getItem(`so_petugas_${id}`);
    if (savedName) {
      setName(savedName);
      setSaved(true);
    }
    supabase
      .from('so_sessions')
      .select('status, name')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        setSessionStatus(data?.status || null);
        setSessionName(data?.name || '');
      });
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

  if (sessionStatus === 'closed') {
    return (
      <div className="mx-auto max-w-md">
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
          <button onClick={() => goTo(`/sessions/${id}/selisih`)} className="card block w-full p-4 text-left transition hover:border-amber/60 hover:shadow-md">
            <div className="font-medium text-ink">Rak Selisih</div>
            <div className="mt-0.5 text-sm text-ink/50">Rak yang sudah di-approve Accounting untuk recount</div>
          </button>
        </div>
      )}
    </div>
  );
}
