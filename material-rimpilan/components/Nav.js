'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/materials', label: 'Master Material' },
  { href: '/barang-masuk', label: 'Barang Masuk' },
  { href: '/barang-keluar', label: 'Barang Keluar' },
  { href: '/riwayat', label: 'Riwayat' },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1">
      {LINKS.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active ? 'bg-slate-850 text-white' : 'text-ink/60 hover:bg-white hover:text-ink'
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
