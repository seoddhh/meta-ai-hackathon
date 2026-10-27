import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const allowed = /^(terrain|config|health|battles(?:\/[a-f0-9]{32}(?:\/(?:advance|strategy|image))?)?)$/;
  const route = path.join('/');
  if (!allowed.test(route)) return Response.json({ detail: 'Unknown route' }, { status: 404 });
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.BACKEND_TOKEN) headers['x-backend-token'] = process.env.BACKEND_TOKEN;
    const response = await fetch(`${process.env.BACKEND_URL || 'http://127.0.0.1:8000'}/${route}`, {
      method: request.method,
      headers,
      body: ['POST', 'PATCH'].includes(request.method) ? await request.text() : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(170_000),
    });
    return new Response(response.body, { status: response.status, headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-store',
    } });
  } catch {
    return Response.json({ detail: '백엔드에 연결할 수 없습니다. Python API 서버와 BACKEND_URL을 확인하세요.' }, { status: 503 });
  }
}

export { proxy as GET, proxy as POST, proxy as PATCH };
