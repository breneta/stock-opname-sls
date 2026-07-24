'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '../../../../../lib/supabaseClient';
import { fetchAll } from '../../../../../lib/fetchAll';

// "Void & Re-input" correction tool for Admin/Accounting.
//
// Entries are append-only by design — rekonsiliasi selalu dihitung ulang
// dari raw so_entries/rimpilan_entries, tidak pernah menimpa data. Jadi
// kalau petugas salah input material/batch/qty, satu-satunya cara resmi
// membetulkannya lewat sini adalah:
//   1. Cari entry yang salah, tekan "Batalkan", isi alasan (wajib).
//   2. Entry itu ditandai voided (voided_at/voided_by/void_reason) —
//      TIDAK dihapus dari database, cuma dikeluarkan dari semua
//      perhitungan (rekonsiliasi, dashboard, export, rak selisih).
//   3. Petugas input ulang entry yang benar lewat halaman Input seperti
//      biasa.
// Ini sengaja bukan direct-edit supaya jejak audit entry yang salah tetap
// utuh dan bisa ditelusuri siapa yang membatalkan, kapan, dan kenapa.
export default function EntriesManagementPage() {
  const { id } = useParams();
  const [sessionName, setSessionName] = useState('');
  const [entries, setEntries] = useState([]); // unified normal + rimpilan
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [adminNama, setAdminNama] = useState('');
  const [voidingId, setVoidingId] = useState(null); // `${source}:${id}` currently being voided
  const [voidReason, setVoidReason] = useState('');
  const [savingVoid, setSavingVoid] = useState(false);

  const [search, setSearch] = useState('');
  const [filterRak, setFilterRak] = useState('');
  const [filterPetugas, setFilterPetugas] = useState('');
  const [filterSource, setFilterSource] = useState(''); // '' | 'normal' | 'rimpilan'
  const [filterStatus, setFilterStatus] = useState(''); // '' | 'aktif' | 'dibatalkan'

  useEffect(() => {
    const saved = localStorage.getItem('so_admin_nama');
    if (saved) setAdminNama(saved);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    setLoading(true);
    setError(null);
    const [{ data: sessionData }, normalEntries, rimpilanEntries] = await Promise.all([
      supabase.from('so_sessions').select('name').eq('id', id).single(),
      fetchAll(() => supabase.from('so_entries').select('*').eq('session_id', id).order('created_at', { ascending: false })),
      fetchAll(() => supabase.from('rimpilan_entries').select('*').eq('session_id', id).order('created_at', { ascending: false })),
    ]);
    setSessionName(sessionData?.name || '');

    const unified = [
      ...(normalEntries || []).map((e) => ({ ...e, source: 'normal' })),
      ...(rimpilanEntries || []).map((e) => ({ ...e, source: 'rimpilan' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    setEntries(unified);
    setLoading(false);
  }

  const rakOptions = useMemo(
    () => [...new Set(entries.map((e) => e.nomor_rak).filter(Boolean))].sort(),
    [entries]
  );
  const petugasOptions = useMemo(
    () => [...new Set(entries.map((e) => e.petugas_nama).filter(Boolean))].sort(),
    [entries]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (term && !`${e.material_code} ${e.material_description || ''}`.toLowerCase().includes(term)) return false;
      if (filterRak && e.nomor_rak !== filterRak) return false;
      if (filterPetugas && e.petugas_nama !== filterPetugas) return false;
      if (filterSource && e.source !== filterSource) return false;
      if (filterStatus === 'aktif' && e.voided_at) return false;
      if (filterStatus === 'dibatalkan' && !e.voided_at) return false;
      return true;
    });
  }, [entries, search, filterRak, filterPetugas, filterSource, filterStatus]);

  function startVoid(entry) {
    if (!adminNama.trim()) {
      setError('Isi "Nama Anda" dulu di atas sebelum membatalkan entry — supaya ada jejak siapa yang membatalkan.');
      return;
    }
    setError(null);
    setVoidReason('');
    setVoidingId(`${entry.source}:${entry.id}`);
  }

  async function confirmVoid(entry) {
    const reason = voidReason.trim();
    if (!reason) {
      setError('Alasan pembatalan wajib diisi.');
      return;
    }
    setSavingVoid(true);
    setError(null);
    const table = entry.source === 'normal' ? 'so_entries' : 'rimpilan_entries';
    const { error: updateError } = await supabase
      .from(table)
      .update({
        voided_at: new Date().toISOString(),
        voided_by: adminNama.trim(),
        void_reason: reason,
      })
      .eq('id', entry.id);
    setSavingVoid(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    localStorage.setItem('so_admin_nama', adminNama.trim());
    setVoidingId(null);
    setVoidReason('');
    load();
  }

  async function unvoid(entry) {
    if (!confirm(`Aktifkan kembali entry ${entry.material_code}? Entry ini akan ikut terhitung lagi di rekonsiliasi.`)) return;
    const table = entry.source === 'normal' ? 'so_entries' : 'rimpilan_entries';
    const { error: updateError } = await supabase
      .from(table)
      .update({ voided_at: null, voided_by: null, void_reason: null })
      .eq('id', entry.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    load();
  }

  const activeCount = entries.filter((e) => !e.voided_at).length;
  const voidedCount = entries.length - activeCount;

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/admin/sessions/${id}`} className="text-xs text-ink/50 hover:text-ink">← {sessionName || 'Session'}</Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Kelola Entry</h1>
        <p className="mt-1 text-sm text-ink/60">
          Koreksi entry yang salah input (material/batch/rak/qty keliru). Entry lama tidak dihapus — hanya
          dibatalkan (void) dan dikeluarkan dari perhitungan, supaya jejak audit tetap utuh. Petugas input
          ulang data yang benar lewat halaman Input seperti biasa.
        </p>
      </div>

      <div className="card p-3.5">
        <label className="label-field">Nama Anda (tercatat sebagai yang membatalkan entry)</label>
        <input
          className="input-field max-w-xs"
          value={adminNama}
          onChange={(e) => setAdminNama(e.target.value)}
          placeholder="Nama Accounting/Admin"
        />
      </div>

      {error && <div className="card border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div>}

      <div className="card flex flex-wrap items-center gap-2 p-3.5">
        <input
          className="input-field max-w-xs"
          placeholder="Cari material code / deskripsi..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input-field w-auto" value={filterRak} onChange={(e) => setFilterRak(e.target.value)}>
          <option value="">Semua Rak</option>
          {rakOptions.map((r) => <option key={r} value={r}>Rak {r}</option>)}
        </select>
        <select className="input-field w-auto" value={filterPetugas} onChange={(e) => setFilterPetugas(e.target.value)}>
          <option value="">Semua Petugas</option>
          {petugasOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="input-field w-auto" value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
          <option value="">Normal + Rimpilan</option>
          <option value="normal">Normal SO saja</option>
          <option value="rimpilan">Rimpilan saja</option>
        </select>
        <select className="input-field w-auto" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">Semua Status</option>
          <option value="aktif">Aktif saja</option>
          <option value="dibatalkan">Dibatalkan saja</option>
        </select>
        <span className="ml-auto text-xs text-ink/50">{activeCount} aktif · {voidedCount} dibatalkan</span>
      </div>

      {loading ? (
        <div className="text-sm text-ink/50">Memuat...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink/40">Tidak ada entry yang cocok dengan filter.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => {
            const key = `${e.source}:${e.id}`;
            const isVoided = !!e.voided_at;
            return (
              <div key={key} className={`card p-3.5 text-sm ${isVoided ? 'border-bad/30 bg-bad/5' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className={isVoided ? 'text-ink/50 line-through decoration-bad/50' : ''}>
                    <div className="flex items-center gap-1.5 font-mono font-medium text-ink">
                      {e.material_code}
                      <span className="badge bg-slate-850/10 text-ink/70 no-underline">{e.source === 'normal' ? 'Normal' : 'Rimpilan'}</span>
                      {e.recount_round > 0 && <span className="badge bg-amber/20 text-warn no-underline">Recount R{e.recount_round}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-ink/50">
                      {e.material_description && <span>{e.material_description} · </span>}
                      Batch {e.batch || '-'} · Rak {e.nomor_rak || '-'} · Lv {e.level ?? '-'}
                      {e.keterangan_khusus ? (
                        <span> · Keterangan Khusus: {e.keterangan_khusus} (Qty {e.qty_fisik})</span>
                      ) : (
                        <span> · Qty {e.qty_fisik} {e.base_uom}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-ink/40">
                      {e.petugas_nama} · {new Date(e.created_at).toLocaleString('id-ID')}
                    </div>
                  </div>

                  {!isVoided && voidingId !== key && (
                    <button type="button" onClick={() => startVoid(e)} className="btn-ghost shrink-0 text-xs text-bad">
                      Batalkan →
                    </button>
                  )}
                  {isVoided && (
                    <button type="button" onClick={() => unvoid(e)} className="btn-ghost shrink-0 text-xs">
                      Aktifkan lagi →
                    </button>
                  )}
                </div>

                {isVoided && (
                  <div className="mt-2 border-t border-bad/20 pt-2 text-xs text-bad">
                    Dibatalkan oleh <span className="font-medium">{e.voided_by}</span> pada{' '}
                    {new Date(e.voided_at).toLocaleString('id-ID')} — {e.void_reason}
                  </div>
                )}

                {!isVoided && voidingId === key && (
                  <div className="mt-2.5 space-y-2 border-t border-line pt-2.5">
                    <label className="label-field">Alasan pembatalan (wajib)</label>
                    <textarea
                      className="input-field"
                      rows={2}
                      value={voidReason}
                      onChange={(ev) => setVoidReason(ev.target.value)}
                      placeholder="Contoh: salah scan kode material, seharusnya ABGTB2201"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={savingVoid}
                        onClick={() => confirmVoid(e)}
                        className="inline-flex items-center justify-center rounded-lg bg-bad px-4 py-2.5 text-xs font-medium text-white transition hover:bg-bad/90 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
                      >
                        {savingVoid ? 'Menyimpan...' : 'Konfirmasi Batalkan'}
                      </button>
                      <button type="button" onClick={() => setVoidingId(null)} className="btn-ghost text-xs">
                        Batal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
