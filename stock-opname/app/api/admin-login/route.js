import { NextResponse } from 'next/server';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request tidak valid.' }, { status: 400 });
  }

  const expected = process.env.ADMIN_PASSCODE;
  if (!expected) {
    return NextResponse.json(
      { error: 'ADMIN_PASSCODE belum di-setup di server. Hubungi yang pegang deployment.' },
      { status: 500 }
    );
  }

  if (body.passcode !== expected) {
    return NextResponse.json({ error: 'Passcode salah.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  // The cookie value IS the passcode itself — no hashing/JWT, matching the
  // rest of this app's security posture (the Supabase anon key is already
  // exposed client-side). httpOnly + Secure so it's at least not readable
  // or stealable via client JS / plain HTTP.
  res.cookies.set('admin_session', expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 hari
  });
  return res;
}
