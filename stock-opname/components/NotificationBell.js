'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { fetchAll } from '../lib/fetchAll';
import { buildCombinedReconciliation } from '../lib/reconciliation';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notFoundItems, setNotFoundItems] = useState([]); // [{ sessionId, sessionName, count }]
  const [selisihItems, setSelisihItems] = useState([]); // [{ sessionId, sessionName, count }]
  const [loading, setLoading] = useState(true);
  const ref = useRef(null);

  useEffect(() => {
    load();
    // Refresh periodically so the badge stays current while Accounting
    // has the tab open without needing a manual reload.
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function load() {
    const { data: sessions } = await supabase
      .from('so_sessions')
      .select('id, name')
      .eq('status', 'active');

    if (!sessions || sessions.length === 0) {
      setNotFoundItems([]);
      setSelisihItems([]);
      setLoading(false);
      return;
    }

    const { data: entries } = await supabase
      .from('so_entries')
      .select('session_id')
      .eq('status_sap', 'tidak_ada_di_sap')
      .in('session_id', sessions.map((s) => s.id));

    const notFoundCounts = new Map();
    for (const e of entries || []) {
      notFoundCounts.set(e.session_id, (notFoundCounts.get(e.session_id) || 0) + 1);
    }
    setNotFoundItems(
      sessions
        .filter((s) => notFoundCounts.has(s.id))
        .map((s) => ({ sessionId: s.id, sessionName: s.name, count: notFoundCounts.get(s.id) }))
    );

    // Selisih needs a full reconciliation per active session (Qty SAP vs
    // Normal + Rimpilan qty_fisik) — no shortcut query for this like the
    // "Tidak Ada di SAP" count above, since Selisih only exists once both
    // sides are compared. Fine to run per active session — in practice
    // there are only a handful of active sessions at once, not hundreds.
    const selisihResults = await Promise.all(
      sessions.map(async (s) => {
        const [sapData, normalEntries, rimpilanEntries] = await Promise.all([
          fetchAll(() => supabase.from('so_sap_data').select('material,batch,plant,storage_location,base_uom,qty,material_description').eq('session_id', s.id)),
          fetchAll(() => supabase.from('so_entries').select('material_code,batch,plant,storage_location,base_uom,qty_fisik,keterangan_khusus,recount_round,status_sap').eq('session_id', s.id)),
          fetchAll(() => supabase.from('rimpilan_entries').select('material_code,batch,plant,storage_location,base_uom,qty_fisik,keterangan_khusus,recount_round').eq('session_id', s.id)),
        ]);
        const sap = (sapData || []).filter((r) => Number(r.qty) > 0);
        const { rows } = buildCombinedReconciliation(sap, normalEntries || [], rimpilanEntries || []);
        const count = rows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang').length;
        return { sessionId: s.id, sessionName: s.name, count };
      })
    );
    setSelisihItems(selisihResults.filter((r) => r.count > 0));

    setLoading(false);
  }

  const notFoundTotal = notFoundItems.reduce((sum, i) => sum + i.count, 0);
  const selisihTotal = selisihItems.reduce((sum, i) => sum + i.count, 0);
  const total = notFoundTotal + selisihTotal;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white transition hover:bg-paper"
        aria-label="Notifikasi"
      >
        <BellIcon />
        {total > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold leading-none text-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-line bg-white p-2 shadow-lg">
          {loading ? (
            <div className="px-2 py-3 text-sm text-ink/50">Memuat...</div>
          ) : total === 0 ? (
            <div className="px-2 py-3 text-sm text-ink/50">Tidak ada notifikasi.</div>
          ) : (
            <div className="max-h-80 space-y-3 overflow-y-auto">
              {selisihItems.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Material Selisih (perlu recount)
                  </div>
                  <div className="space-y-0.5">
                    {selisihItems.map((i) => (
                      <Link
                        key={i.sessionId}
                        href={`/admin/sessions/${i.sessionId}`}
                        onClick={() => setOpen(false)}
                        className="flex items-center justify-between rounded-lg px-2 py-2 text-sm transition hover:bg-paper"
                      >
                        <span className="truncate">{i.sessionName}</span>
                        <span className="badge ml-2 shrink-0 bg-warn/10 text-warn">{i.count}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {notFoundItems.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Material/Batch Tidak Ada di Master Data
                  </div>
                  <div className="space-y-0.5">
                    {notFoundItems.map((i) => (
                      <Link
                        key={i.sessionId}
                        href={`/admin/sessions/${i.sessionId}/reconciliation?status=${encodeURIComponent('Tidak Ada di SAP')}`}
                        onClick={() => setOpen(false)}
                        className="flex items-center justify-between rounded-lg px-2 py-2 text-sm transition hover:bg-paper"
                      >
                        <span className="truncate">{i.sessionName}</span>
                        <span className="badge ml-2 shrink-0 bg-bad/10 text-bad">{i.count}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
