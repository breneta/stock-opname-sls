import './globals.css';
import Nav from '../components/Nav';

export const metadata = {
  title: 'Material Rimpilan',
  description: 'Manajemen Material Rimpilan — stok di luar SAP',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <div className="mx-auto min-h-screen max-w-5xl px-4 pb-16 pt-6 sm:px-6">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <a href="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-850 font-mono text-sm font-bold text-teal">
                MR
              </span>
              <span className="text-sm font-semibold tracking-tight">Material Rimpilan</span>
            </a>
            <Nav />
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
