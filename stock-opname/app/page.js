'use client';

import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Stock Opname</h1>
        <p className="mt-2 text-sm text-ink/60">Pilih peran Anda untuk melanjutkan.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/mulai"
          className="card group flex flex-col justify-between p-6 transition hover:border-amber/60 hover:shadow-md"
        >
          <div>
            <span className="badge bg-amber/20 text-warn">Petugas Lapangan</span>
            <h2 className="mt-3 text-lg font-semibold">Mulai Stock Opname</h2>
            <p className="mt-1.5 text-sm text-ink/60">
              Langsung pilih session yang sudah dibuat Accounting, lalu mulai input hitung fisik.
            </p>
          </div>
          <span className="mt-5 text-sm font-medium text-ink group-hover:underline">
            Pilih Session →
          </span>
        </Link>

        <Link
          href="/admin"
          className="card group flex flex-col justify-between p-6 transition hover:border-slate-850/40 hover:shadow-md"
        >
          <div>
            <span className="badge bg-slate-850/10 text-ink">Accounting / Admin</span>
            <h2 className="mt-3 text-lg font-semibold">Kelola Session</h2>
            <p className="mt-1.5 text-sm text-ink/60">
              Buat session baru, upload Data SAP, pantau progress, rekonsiliasi, dan export laporan.
            </p>
          </div>
          <span className="mt-5 text-sm font-medium text-ink group-hover:underline">
            Buka Dashboard →
          </span>
        </Link>
      </div>
    </div>
  );
}
