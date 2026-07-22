'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

export default function HomePage() {
  const [sessions, setSessions] = useState([]);
  const [notFoundCounts, setNotFoundCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // session being confirmed for deletion

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

  // Deletes every table that belongs to this session, children first, then
  // the so_sessions row itself. Done explicitly here rather than relying on
  // ON DELETE CASCADE — this repo doesn't have a tracked base schema file
  // for so_sessions/so_sap_data/so_entries, so there's no way to confirm
  // cascade is actually configured on those FKs. Explicit deletes work
  // either way. That's also why the modal requires re-typing the session
  // name instead of a single confirm click — this is permanent.
  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    const sessionId = deleteTarget.id;
    const childTables = [
      'so_entries',
      'so_sap_data',
      'rimpilan_entries',
      'rimpilan_sap_data',
      'warehouse_racks',
      'so_recount_rounds',
    ];
    for (const table of childTables) {
      const { error: childError } = await supabase.from(table).delete().eq('session_id', sessionId);
      if (childError) {
        setError(`Gagal menghapus data dari ${table}: ${childError.message}`);
        setDeleteTarget(null);
        return;
      }
    }
    const { error: deleteError } = await supabase.from('so_sessions').delete().eq('id', sessionId);
    if (deleteError) {
      setError(deleteError.message);
      setDeleteTarget(null);
      return;
    }
    setDeleteTarget(null);
    loadSessions();
  }

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
                  <SessionCard
                    key={s.id}
                    session={s}
                    notFoundCount={notFoundCounts[s.id] || 0}
                    onDelete={() => setDeleteTarget(s)}
                  />
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
                  <SessionCard
                    key={s.id}
                    session={s}
                    notFoundCount={notFoundCounts[s.id] || 0}
                    onDelete={() => setDeleteTarget(s)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {deleteTarget && (
        <DeleteSessionModal session={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={handleDeleteConfirmed} />
      )}
    </div>
  );
}

function SessionCard({ session, notFoundCount, onDelete }) {
  return (
    <Link
      href={`/admin/sessions/${session.id}`}
      className="card group relative block p-4 transition hover:border-slate-850/30 hover:shadow-md"
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
        <div className="flex items-start gap-1.5">
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
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line text-bad/70 transition hover:border-bad/40 hover:bg-bad/5 hover:text-bad"
            aria-label={`Hapus session ${session.name}`}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </Link>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

// Deleting a session cascades to every table that references it (Data SAP,
// Normal SO entries, Rimpilan master + entries, warehouse racks, recount
// rounds) — permanent and unrecoverable. Re-typing the exact session name
// is the safeguard against an accidental click, same pattern as most
// "delete this repo / delete this workspace" flows.
function DeleteSessionModal({ session, onCancel, onConfirm }) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const matches = confirmText.trim() === session.name;

  async function handleConfirm() {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg">
        <div className="flex items-center gap-2 text-bad">
          <AlertTriangleIcon />
          <div className="font-medium">Hapus session ini?</div>
        </div>
        <p className="mt-2 text-sm text-ink/60">
          Semua data ikut terhapus permanen: Data SAP, seluruh hasil input Normal SO, Rimpilan, dan riwayat
          recount. Tidak bisa dibatalkan.
        </p>
        <label className="label-field mt-3">Ketik nama session untuk konfirmasi</label>
        <div className="font-mono text-sm font-medium text-ink">{session.name}</div>
        <input
          className="input-field mt-1.5"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Ketik ulang nama di atas"
          autoFocus
        />
        <div className="mt-4 flex gap-2">
          <button onClick={onCancel} className="btn-ghost flex-1" disabled={deleting}>Batal</button>
          <button
            onClick={handleConfirm}
            disabled={!matches || deleting}
            className="btn-primary flex-1 bg-bad hover:bg-bad/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {deleting ? 'Menghapus...' : 'Hapus Permanen'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
