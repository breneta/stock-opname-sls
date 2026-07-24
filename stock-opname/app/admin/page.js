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

  async function handleLogout() {
    await fetch('/api/admin-logout', { method: 'POST' });
    window.location.href = '/admin/login';
  }

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
        .is('voided_at', null)
        .in('session_id', data.map((s) => s.id));
      const counts = {};
      for (const e of entries || []) {
        counts[e.session_id] = (counts[e.session_id] || 0) + 1;
      }
      setNotFoundCounts(counts);
    }
  }

  const active = sessions.filter((s) => s.status === 'active' && !s.archived_at);
  const closed = sessions.filter((s) => s.status !== 'active' && !s.archived_at);
  const archived = sessions.filter((s) => !!s.archived_at);

  // Deletes every table that belongs to this session, children first, then
  // the so_sessions row itself. Done explicitly here rather than relying on
  // ON DELETE CASCADE — this repo doesn't have a tracked base schema file
  // for so_sessions/so_sap_data/so_entries, so there's no way to confirm
  // cascade is actually configured on those FKs. Explicit deletes work
  // either way. That's also why "Hapus Permanen" requires re-typing the
  // session name instead of a single confirm click — this is unrecoverable.
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

  // The safer default: nothing is deleted, the session just stops showing
  // up in Sedang Berjalan / History. Data + retention intact for audit
  // purposes (typically 5-7 years for physical count records) — reversible
  // any time via "Pulihkan" in the Diarsipkan section below.
  async function handleArchiveConfirmed() {
    if (!deleteTarget) return;
    const { error: archiveError } = await supabase
      .from('so_sessions')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', deleteTarget.id);
    if (archiveError) {
      setError(archiveError.message);
    }
    setDeleteTarget(null);
    loadSessions();
  }

  async function handleRestore(session) {
    const { error: restoreError } = await supabase
      .from('so_sessions')
      .update({ archived_at: null })
      .eq('id', session.id);
    if (restoreError) {
      setError(restoreError.message);
      return;
    }
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
        <div className="flex items-center gap-2">
          <Link href="/admin/sessions/new" className="btn-primary">
            + Session Baru
          </Link>
          <button onClick={handleLogout} className="btn-ghost text-sm">Keluar</button>
        </div>
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

          {archived.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/50">
                Diarsipkan ({archived.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {archived.map((s) => (
                  <div key={s.id} className="card flex items-center justify-between p-4">
                    <div>
                      <div className="font-medium text-ink/60">{s.name}</div>
                      <div className="mt-1 text-xs text-ink/40">
                        Diarsipkan {new Date(s.archived_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </div>
                    </div>
                    <button onClick={() => handleRestore(s)} className="btn-ghost text-xs shrink-0">Pulihkan</button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {deleteTarget && (
        <DeleteSessionModal
          session={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onArchive={handleArchiveConfirmed}
          onDelete={handleDeleteConfirmed}
        />
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

// Two options, deliberately different friction levels:
// - Arsipkan: reversible (just sets archived_at), so it's a single click —
//   no data touched, safe to undo any time from the Diarsipkan section.
// - Hapus Permanen: cascades a real delete across every table that
//   references this session (Data SAP, Normal SO entries, Rimpilan master +
//   entries, warehouse racks, recount rounds) — unrecoverable, so it stays
//   gated behind re-typing the exact session name.
function DeleteSessionModal({ session, onCancel, onArchive, onDelete }) {
  const [confirmText, setConfirmText] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const matches = confirmText.trim() === session.name;

  async function handleArchiveClick() {
    setArchiving(true);
    await onArchive();
    setArchiving(false);
  }

  async function handleDeleteClick() {
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  }

  const busy = archiving || deleting;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg">
        <div className="flex items-center gap-2 text-bad">
          <AlertTriangleIcon />
          <div className="font-medium">Hapus session "{session.name}"?</div>
        </div>
        <p className="mt-2 text-sm text-ink/60">Pilih salah satu — dua-duanya membuat session ini hilang dari daftar utama.</p>

        <div className="mt-4 rounded-lg border border-line p-3.5">
          <div className="text-sm font-medium">Arsipkan (disarankan)</div>
          <p className="mt-1 text-xs text-ink/60">
            Data tetap tersimpan lengkap untuk keperluan audit — bisa dipulihkan kapan saja lewat bagian
            "Diarsipkan".
          </p>
          <button onClick={handleArchiveClick} disabled={busy} className="btn-primary mt-3 w-full">
            {archiving ? 'Mengarsipkan...' : 'Arsipkan'}
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-bad/30 bg-bad/5 p-3.5">
          <div className="text-sm font-medium text-bad">Hapus Permanen</div>
          <p className="mt-1 text-xs text-ink/60">
            Semua data ikut terhapus permanen: Data SAP, seluruh hasil input Normal SO, Rimpilan, dan
            riwayat recount. Tidak bisa dibatalkan atau dipulihkan.
          </p>
          <label className="label-field mt-2">Ketik nama session untuk konfirmasi</label>
          <div className="font-mono text-xs font-medium text-ink">{session.name}</div>
          <input
            className="input-field mt-1.5"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Ketik ulang nama di atas"
          />
          <button
            onClick={handleDeleteClick}
            disabled={!matches || busy}
            className="btn-primary mt-3 w-full bg-bad hover:bg-bad/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {deleting ? 'Menghapus...' : 'Hapus Permanen'}
          </button>
        </div>

        <button onClick={onCancel} className="btn-ghost mt-3 w-full" disabled={busy}>Batal</button>
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
