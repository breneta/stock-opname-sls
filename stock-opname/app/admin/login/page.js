'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const notConfigured = searchParams.get('error') === 'not_configured';

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch('/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Gagal masuk.');
      return;
    }
    router.replace(searchParams.get('redirect') || '/admin');
    router.refresh();
  }

  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Masuk Admin</h1>
        <p className="mt-1 text-sm text-ink/60">
          Halaman ini khusus Accounting/Admin. Masukkan passcode untuk lanjut.
        </p>
      </div>

      {notConfigured && (
        <div className="card border-bad/30 bg-bad/5 p-3 text-sm text-bad">
          <span className="font-medium">ADMIN_PASSCODE belum di-setup di server.</span> Hubungi yang pegang
          deployment untuk set environment variable ini dulu — tanpa itu halaman Admin tetap terkunci.
        </div>
      )}

      <form onSubmit={handleSubmit} className="card space-y-3 p-5">
        <div>
          <label className="label-field">Passcode</label>
          <input
            type="password"
            className="input-field"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus
          />
        </div>
        {error && <div className="text-sm text-bad">{error}</div>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Memeriksa...' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}
