'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { parseRecountCodes } from '../../../../lib/recountCodes';

// Petugas-facing, grouped by RAK — but ONLY for materials Accounting has
// already approved via "Mulai Recount" in Admin (session.recount_material_
// codes). This is deliberately gated, not a free real-time reconciliation:
// Accounting's approval is the control point before anyone goes recounting
// anything, same as the Input pages' recount banner. This page just
// reorganizes that same approved list by rak (petugas walk racks, not
// individual SKUs) and adds "who last counted here" for accountability.
//
// Still NEVER shows Qty SAP / Qty Tercatat / Selisih — that stays blind
// even during an approved recount, only visible in the Admin dashboard.
export default function SelisihPage() {
  const { id } = useParams();
  const router = useRouter();

  const [petugas, setPetugas] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeRecountRound, setActiveRecountRound] = useState(0);
  const [rakGroups, setRakGroups] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem(`so_petugas_${id}`);
    if (!saved) {
      router.replace(`/sessions/${id}/start`);
      return;
    }
    setPetugas(saved);
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [id, router]);

  async function load() {
    const { data: sessionData } = await supabase
      .from('so_sessions')
      .select('active_recount_round, recount_material_codes')
      .eq('id', id)
      .single();

    setActiveRecountRound(sessionData?.active_recount_round || 0);
    // parseRecountCodes unwraps rows where an entry ended up as a
    // JSON-encoded string instead of a parsed object.
    const approved = parseRecountCodes(sessionData?.recount_material_codes);

    if (approved.length === 0) {
      setRakGroups([]);
      setLastUpdate(new Date());
      setLoading(false);
      return;
    }

    const approvedCodes = approved.map((c) => c.code);
    const sourceByCode = Object.fromEntries(approved.map((c) => [c.code, c.source || 'normal']));

    // Rak isn't master data for Normal SO (only Rimpilan has nomor_rak in
    // its master upload) — it only exists in whatever petugas typed on a
    // previous entry. No recount_round filter here on purpose: we want
    // wherever this material was last seen, regardless of round, since the
    // physical location doesn't reset when a new round starts.
    const [{ data: normalEntries }, { data: rimpilanEntries }] = await Promise.all([
      supabase
        .from('so_entries')
        .select('material_code, material_description, nomor_rak, petugas_nama, created_at')
        .eq('session_id', id)
        .is('voided_at', null)
        .in('material_code', approvedCodes),
      supabase
        .from('rimpilan_entries')
        .select('material_code, material_description, nomor_rak, petugas_nama, created_at')
        .eq('session_id', id)
        .is('voided_at', null)
        .in('material_code', approvedCodes),
    ]);

    const byRak = new Map(); // rak -> { rak, materials: Map<material, {source, description}>, allEntries: [] }
    const addEntry = (e, source) => {
      const rak = e.nomor_rak || '(tanpa rak)';
      if (!byRak.has(rak)) byRak.set(rak, { rak, materials: new Map(), allEntries: [] });
      const group = byRak.get(rak);
      if (!group.materials.has(e.material_code)) {
        group.materials.set(e.material_code, { material: e.material_code, material_description: e.material_description, source });
      }
      group.allEntries.push(e);
    };
    for (const e of normalEntries || []) addEntry(e, sourceByCode[e.material_code]);
    for (const e of rimpilanEntries || []) addEntry(e, sourceByCode[e.material_code]);

    // Approved materials that have never been counted before (brand-new
    // discrepancy with zero prior entries — shouldn't happen often, but
    // possible) have no rak to group under. Surface them separately instead
    // of silently dropping them.
    const seenCodes = new Set([...(normalEntries || []), ...(rimpilanEntries || [])].map((e) => e.material_code));
    const unseenCodes = approvedCodes.filter((c) => !seenCodes.has(c));
    if (unseenCodes.length > 0) {
      const rak = '(belum pernah dihitung)';
      byRak.set(rak, {
        rak,
        materials: new Map(unseenCodes.map((c) => [c, { material: c, material_description: '', source: sourceByCode[c] }])),
        allEntries: [],
      });
    }

    const groups = [...byRak.values()]
      .map((g) => {
        const sorted = [...g.allEntries].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const lastEntry = sorted[sorted.length - 1];
        return {
          rak: g.rak,
          materials: [...g.materials.values()].sort((a, b) => a.material.localeCompare(b.material)),
          lastPetugas: lastEntry?.petugas_nama || null,
        };
      })
      .sort((a, b) => a.rak.localeCompare(b.rak));

    setRakGroups(groups);
    setLastUpdate(new Date());
    setLoading(false);
  }

  const totalMaterials = rakGroups.reduce((sum, g) => sum + g.materials.length, 0);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/sessions/${id}/input`} className="text-xs text-ink/50 hover:text-ink">← Input Normal SO</Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Rak Selisih</h1>
        </div>
        <div className="badge bg-slate-850/10 text-ink">{petugas}</div>
      </div>

      <div className="card p-3.5 text-xs text-ink/50">
        Hanya material yang sudah di-approve Accounting untuk recount yang muncul di sini, disusun per
        rak. Tidak menampilkan Qty.
        {lastUpdate && <span className="ml-1">Update terakhir {lastUpdate.toLocaleTimeString('id-ID')}.</span>}
      </div>

      {loading ? (
        <div className="text-sm text-ink/50">Memuat...</div>
      ) : rakGroups.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink/40">
          Belum ada material yang di-approve Accounting untuk recount saat ini.
        </div>
      ) : (
        <div className="space-y-3">
          {activeRecountRound > 0 && (
            <div className="text-xs text-warn">🔄 Recount Round {activeRecountRound} sedang berjalan.</div>
          )}
          {rakGroups.map((g) => (
            <div key={g.rak} className="card p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-mono text-sm font-semibold">Rak {g.rak}</div>
                  {g.lastPetugas && (
                    <div className="mt-0.5 text-xs text-ink/40">
                      Terakhir dihitung oleh: <span className="font-medium text-ink/60">{g.lastPetugas}</span>
                    </div>
                  )}
                </div>
                <span className="badge bg-bad/10 text-bad shrink-0">{g.materials.length} material</span>
              </div>

              <div className="mt-2.5 space-y-1.5 border-t border-line pt-2.5">
                {g.materials.map((m) => (
                  <div key={m.material} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-xs font-medium">{m.material}</span>
                      <span className="ml-1.5 truncate text-xs text-ink/50">{m.material_description}</span>
                      {m.source !== 'normal' && (
                        <span className="badge ml-1.5 bg-amber/20 text-warn">{m.source === 'both' ? 'Normal + Rimpilan' : 'Rimpilan'}</span>
                      )}
                    </div>
                    {m.source === 'rimpilan' ? (
                      <Link href={`/sessions/${id}/rimpilan/input`} className="btn-ghost shrink-0 text-xs">
                        Cek →
                      </Link>
                    ) : (
                      <Link
                        href={`/sessions/${id}/input?material=${encodeURIComponent(m.material)}${g.rak && !g.rak.startsWith('(') ? `&rak=${encodeURIComponent(g.rak)}` : ''}`}
                        className="btn-ghost shrink-0 text-xs"
                      >
                        Cek →
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="text-center text-xs text-ink/40">{totalMaterials} material selisih di {rakGroups.length} rak.</div>
        </div>
      )}
    </div>
  );
}
