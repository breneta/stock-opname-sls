import './globals.css';
import NotificationBell from '../components/NotificationBell';

export const metadata = {
  title: 'Stock Opname',
  description: 'Aplikasi Stock Opname — Finance & Warehouse',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <div className="mx-auto min-h-screen max-w-5xl px-4 pb-16 pt-6 sm:px-6">
          <header className="mb-6 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-850 font-mono text-sm font-bold text-amber">
                SO
              </span>
              <span className="text-sm font-semibold tracking-tight">Stock Opname</span>
            </a>
            <NotificationBell />
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
