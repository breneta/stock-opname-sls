'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]); // [{ sessionId, sessionName, count }]
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
      setItems([]);
      setLoading(false);
      return;
    }

    const { data: entries } = await supabase
      .from('so_entries')
      .select('session_id')
      .eq('status_sap', 'tidak_ada_di_sap')
      .in('session_id', sessions.map((s) => s.id));

    const counts = new Map();
    for (const e of entries || []) {
      counts.set(e.session_id, (counts.get(e.session_id) || 0) + 1);
    }

    const result = sessions
      .filter((s) => counts.has(s.id))
      .map((s) => ({ sessionId: s.id, sessionName: s.name, count: counts.get(s.id) }));

    setItems(result);
    setLoading(false);
  }

  const total = items.reduce((sum, i) => sum + i.count, 0);

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
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-line bg-white p-2 shadow-lg">
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink/50">
            Material Tidak Ada di SAP
          </div>
          {loading ? (
            <div className="px-2 py-3 text-sm text-ink/50">Memuat...</div>
          ) : items.length === 0 ? (
            <div className="px-2 py-3 text-sm text-ink/50">Tidak ada notifikasi.</div>
          ) : (
            <div className="max-h-72 space-y-0.5 overflow-y-auto">
              {items.map((i) => (
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
