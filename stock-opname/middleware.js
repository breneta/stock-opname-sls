import { NextResponse } from 'next/server';

// Everything under /admin (Accounting/Admin only — upload Data SAP, start
// recount, delete session, etc.) used to have NO access control at all: any
// petugas who knew or guessed the URL could open it. This middleware runs
// server-side before any /admin page renders, so it actually blocks
// navigation — not just hiding a link in the UI. Deliberately NOT applied
// to /sessions/* (petugas input pages), which stay open by name only.
//
// This is a shared passcode, not per-user accounts — good enough to keep
// petugas from wandering into Admin by accident or curiosity, but it does
// NOT give you an audit trail of "who did what" (everyone with the
// passcode looks the same). If that's needed later, this needs to become
// real per-user auth (e.g. Supabase Auth) instead.
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE;

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (pathname === '/admin/login') {
    return NextResponse.next();
  }

  if (!ADMIN_PASSCODE) {
    // Fail CLOSED, not open — a forgotten env var on a fresh deploy should
    // never silently leave /admin unlocked.
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('error', 'not_configured');
    return NextResponse.redirect(loginUrl);
  }

  const cookie = request.cookies.get('admin_session')?.value;
  if (cookie !== ADMIN_PASSCODE) {
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
