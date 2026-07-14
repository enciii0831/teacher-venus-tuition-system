import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const out = new URL('./dist/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(new URL('./dist/server/', import.meta.url), { recursive: true });
await mkdir(new URL('./dist/static/', import.meta.url), { recursive: true });

const worker = `const html=${JSON.stringify(html)};
export default { async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/health') return new Response('ok');
  if (url.pathname !== '/' && url.pathname !== '/index.html') return new Response('Not found', { status: 404 });
  return new Response(html, { headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://sunkovtufoifsvfmqwas.supabase.co wss://sunkovtufoifsvfmqwas.supabase.co; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  }});
}};`;

await writeFile(new URL('./dist/server/index.js', import.meta.url), worker);
await writeFile(new URL('./dist/static/index.html', import.meta.url), html);
console.log('Cloud-ready site build created.');
