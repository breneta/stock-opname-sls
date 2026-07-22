'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

export default function HomePage() {
  const [sessions, setSessions] = useState([]);
  const [notFoundCounts, setNotFoundCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setLoading(true);
    const { data, error } = await supabase
      .from('so_sessions')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    setSessions(data || []);
    setLoading(false);

    if (data && data.length > 0) {
      const { data: entries } = await supabase
        .from('so_entries')
        .select('session_id')
        .eq('status_sap', 'tidak_ada_di_sap')
        .in('session_id', data.map((s) => s.id));
      const counts = {};
      for (const e of entries || []) {
        counts[e.session_id] = (counts[e.session_id] || 0) + 1;
      }
      setNotFoundCounts(counts);
    }
  }

  const active = sessions.filter((s) => s.status === 'active');
  const closed = sessions.filter((s) => s.status !== 'active');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-ink/50 hover:text-ink">← Beranda</Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Accounting / Admin</h1>
          <p className="mt-1 text-sm text-ink/60">Kelola session, upload Data SAP, dan lihat progress semua RDC.</p>
        </div>
        <Link href="/admin/sessions/new" className="btn-primary">
          + Session Baru
        </Link>
      </div>

      {error && (
        <div className="card border-bad/30 bg-bad/5 p-4 text-sm text-bad">
          Gagal memuat data: {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-ink/50">Memuat session...</div>
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/50">
              Sedang Berjalan
            </h2>
            {active.length === 0 ? (
              <div className="card p-6 text-center text-sm text-ink/50">
                Belum ada session aktif. Buat session baru untuk memulai.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {active.map((s) => (
                  <SessionCard key={s.id} session={s} notFoundCount={notFoundCounts[s.id] || 0} />
                ))}
              </div>
            )}
          </section>

          {closed.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/50">
                History
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {closed.map((s) => (
                  <SessionCard key={s.id} session={s} notFoundCount={notFoundCounts[s.id] || 0} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SessionCard({ session, notFoundCount }) {
  return (
    <Link
      href={`/admin/sessions/${session.id}`}
      className="card block p-4 transition hover:border-slate-850/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium text-ink">{session.name}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-ink/50">
            {session.plant && <span className="font-medium text-ink/70">{session.plant}</span>}
            <span>
              Dibuat {new Date(session.created_at).toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span
            className={`badge ${
              session.status === 'active' ? 'bg-good/10 text-good' : 'bg-ink/10 text-ink/60'
            }`}
          >
            {session.status === 'active' ? 'Aktif' : 'Selesai'}
          </span>
          {notFoundCount > 0 && (
            <span className="badge bg-bad/10 text-bad">{notFoundCount} tidak ada di SAP</span>
          )}
        </div>
      </div>
    </Link>
  );
}
