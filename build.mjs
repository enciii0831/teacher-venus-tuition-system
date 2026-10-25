import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const [html, css, app, supabaseClient] = await Promise.all([
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./styles.css', import.meta.url), 'utf8'),
  readFile(new URL('./app.js', import.meta.url), 'utf8'),
  readFile(new URL('./supabase-client.js', import.meta.url), 'utf8')
]);
const out = new URL('./dist/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(new URL('./dist/server/', import.meta.url), { recursive: true });
await mkdir(new URL('./dist/static/', import.meta.url), { recursive: true });

const worker = `const assets=new Map([
  ['/',{body:${JSON.stringify(html)},type:'text/html; charset=utf-8'}],
  ['/index.html',{body:${JSON.stringify(html)},type:'text/html; charset=utf-8'}],
  ['/404.html',{body:${JSON.stringify(html)},type:'text/html; charset=utf-8'}],
  ['/styles.css',{body:${JSON.stringify(css)},type:'text/css; charset=utf-8'}],
  ['/app.js',{body:${JSON.stringify(app)},type:'text/javascript; charset=utf-8'}],
  ['/supabase-client.js',{body:${JSON.stringify(supabaseClient)},type:'text/javascript; charset=utf-8'}]
]);
export default { async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/health') return new Response('ok');
  const asset=assets.get(url.pathname);
  if (!asset) return new Response('Not found', { status: 404 });
  return new Response(asset.body, { headers: {
    'content-type': asset.type,
    'cache-control': 'no-store',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://qifgncrtrlwskvojbbgu.supabase.co wss://qifgncrtrlwskvojbbgu.supabase.co; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  }});
}};`;

await writeFile(new URL('./dist/server/index.js', import.meta.url), worker);
await writeFile(new URL('./dist/static/index.html', import.meta.url), html);
await writeFile(new URL('./dist/static/404.html', import.meta.url), html);
await writeFile(new URL('./dist/static/styles.css', import.meta.url), css);
await writeFile(new URL('./dist/static/app.js', import.meta.url), app);
await writeFile(new URL('./dist/static/supabase-client.js', import.meta.url), supabaseClient);
await writeFile(new URL('./dist/static/.nojekyll', import.meta.url), '');
await writeFile(new URL('./dist/static/robots.txt', import.meta.url), 'User-agent: *\nDisallow: /\n');
console.log('Cloud-ready site build created.');
