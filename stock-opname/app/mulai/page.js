'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

export default function MulaiPage() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('so_sessions')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    setSessions(data || []);
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link href="/" className="text-xs text-ink/50 hover:text-ink">← Beranda</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold tracking-tight">Pilih Session</h1>
      <p className="mb-6 text-sm text-ink/60">
        Session di bawah ini sudah dibuat dan diisi Data SAP oleh Accounting. Pilih RDC / periode
        yang sesuai dengan tugas Anda hari ini.
      </p>

      {error && (
        <div className="card mb-4 border-bad/30 bg-bad/5 p-4 text-sm text-bad">
          Gagal memuat data: {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-ink/50">Memuat session...</div>
      ) : sessions.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink/50">
          Belum ada session aktif. Minta Accounting untuk membuat session dan upload Data SAP
          terlebih dahulu.
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/sessions/${s.id}/start`}
              className="card flex items-center justify-between p-4 transition hover:border-amber/60 hover:shadow-md"
            >
              <div>
                <div className="font-medium text-ink">{s.name}</div>
                <div className="mt-1 text-xs text-ink/50">
                  Dibuat {new Date(s.created_at).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </div>
              </div>
              <span className="badge bg-amber/20 text-warn">Mulai →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
