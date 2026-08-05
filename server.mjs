import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const publicRoot = join(root, 'public');
const filesRoot = join(root, 'files');
const storageRoot = join(root, 'storage');
const envPath = join(root, '.env');

function loadEnv() {
  const env = {};
  if (!existsSync(envPath)) return env;
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }
  return env;
}

const env = loadEnv();
const resultsPath = (env.RESULTS_PATH || '/Rezultate-tabel-invitatie').replace(/\/$/, '') || '/';
const appKey = env.APP_KEY || 'change-this-key-before-deploying';
const resultsPassword = env.RESULTS_PASSWORD || '';
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';

mkdirSync(storageRoot, { recursive: true });
const db = new DatabaseSync(join(storageRoot, 'responses.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_name TEXT NOT NULL,
    attendance INTEGER NOT NULL CHECK (attendance IN (0, 1)),
    guests INTEGER NOT NULL DEFAULT 1 CHECK (guests BETWEEN 1 AND 20),
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    ip_hash TEXT NOT NULL
  );
`);
const recentResponse = db.prepare('SELECT created_at FROM responses WHERE ip_hash = ? AND created_at >= ? LIMIT 1');
const insertResponse = db.prepare('INSERT INTO responses (guest_name, attendance, guests, message, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)');
const listResponses = db.prepare('SELECT id, guest_name, attendance, guests, message, created_at FROM responses ORDER BY id DESC');

const imageMap = {
  hero: 'Rebeca Maria - newborn_44.jpg',
  story: 'Rebeca Maria - newborn_76.jpg',
  'gallery-one': 'Rebeca Maria - newborn_46.jpg',
  'gallery-two': 'Rebeca Maria - newborn_18.jpg',
  'gallery-three': 'Rebeca Maria - newborn_33.jpg',
  'gallery-four': 'Rebeca Maria - newborn_60.jpg',
};
const sessions = new Map();

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function getSession(request, response) {
  const cookies = parseCookies(request);
  let id = cookies.scufita_session;
  let session = id ? sessions.get(id) : null;
  if (!session) {
    id = randomBytes(24).toString('hex');
    session = { csrf: randomBytes(32).toString('hex'), authenticated: false, lastSubmission: 0, createdAt: Date.now() };
    sessions.set(id, session);
    const secure = request.headers['x-forwarded-proto'] === 'https';
    response.setHeader('Set-Cookie', `scufita_session=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
  }
  return session;
}

function commonHeaders(response, contentType = 'text/html; charset=utf-8') {
  response.setHeader('Content-Type', contentType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

function sendJson(response, payload, status = 200) {
  commonHeaders(response, 'application/json; charset=utf-8');
  response.writeHead(status);
  response.end(JSON.stringify(payload));
}

function sendNotFound(response) {
  commonHeaders(response);
  response.writeHead(404);
  response.end('<!doctype html><meta charset="utf-8"><title>Nu am găsit pagina</title><style>body{font-family:system-ui;background:#f7f0e7;color:#332521;display:grid;place-items:center;min-height:100vh}a{color:#8f2530}</style><p>Pagina nu există. <a href="/">Înapoi la invitație</a></p>');
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 32_000) reject(new Error('body-too-large'));
    });
    request.on('end', () => resolveBody(body));
    request.on('error', reject);
  });
}

function validCsrf(session, value) {
  if (!value || typeof value !== 'string') return false;
  const received = Buffer.from(value);
  const expected = Buffer.from(session.csrf);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function ipHash(request) {
  return createHmac('sha256', appKey).update(request.socket.remoteAddress || 'unknown').digest('hex');
}

async function handleRsvp(request, response, session) {
  let data;
  try {
    data = new URLSearchParams(await readBody(request));
  } catch {
    return sendJson(response, { ok: false, message: 'Datele trimise sunt prea mari.' }, 413);
  }
  if (!validCsrf(session, data.get('csrf'))) return sendJson(response, { ok: false, message: 'Sesiunea a expirat. Reîncarcă pagina.' }, 419);
  if (data.get('company')) return sendJson(response, { ok: true, message: 'Mulțumim!' }, 201);

  const name = (data.get('guest_name') || '').trim();
  const attendance = data.get('attendance');
  const guests = Number(data.get('guests'));
  const message = (data.get('message') || '').trim();
  if (!name || name.length > 100 || !['yes', 'no'].includes(attendance) || !Number.isInteger(guests) || guests < 1 || guests > 20 || message.length > 500) {
    return sendJson(response, { ok: false, message: 'Te rugăm să verifici câmpurile completate.' }, 422);
  }
  const now = Date.now();
  if (now - session.lastSubmission < 60_000) return sendJson(response, { ok: false, message: 'Am primit deja un răspuns de pe această conexiune.' }, 429);
  const createdAt = new Date().toISOString();
  if (recentResponse.get(ipHash(request), new Date(now - 60_000).toISOString())) {
    return sendJson(response, { ok: false, message: 'Am primit deja un răspuns de pe această conexiune.' }, 429);
  }
  insertResponse.run(name, attendance === 'yes' ? 1 : 0, guests, message, createdAt, ipHash(request));
  session.lastSubmission = now;
  return sendJson(response, { ok: true, message: 'Răspunsul tău a fost trimis cu drag.' }, 201);
}

function resultsPage(session, error = '') {
  const auth = session.authenticated;
  const rows = auth ? listResponses.all() : [];
  const loginMessage = error ? `<p role="alert" style="color:#a03535">${escapeHtml(error)}</p>` : '';
  const table = rows.map((row) => {
    const yes = Number(row.attendance) === 1;
    const localDate = new Intl.DateTimeFormat('ro-RO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Bucharest' }).format(new Date(row.created_at));
    return `<tr><td>${escapeHtml(row.guest_name)}</td><td class="${yes ? 'yes' : 'no'}">${yes ? 'Da' : 'Nu'}</td><td>${row.guests}</td><td class="message">${escapeHtml(row.message)}</td><td>${escapeHtml(localDate)}</td></tr>`;
  }).join('') || '<tr><td colspan="5">Nu există încă răspunsuri.</td></tr>';
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>Rezultate invitație</title><style>body{margin:0;background:#f7f0e7;color:#332521;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:1100px;margin:auto;padding:32px 20px}.top{display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap}h1{font-family:Georgia,serif;font-weight:500;margin:0 0 8px;color:#711d25}.muted{color:#735e55}.card{background:#fffdf9;border:1px solid #e6d4c5;border-radius:18px;padding:24px;box-shadow:0 12px 35px #5b2d1b12}form{display:grid;gap:14px;max-width:380px}label{display:grid;gap:6px;font-weight:600}input{font:inherit;padding:12px 14px;border-radius:10px;border:1px solid #d9c4b3}button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:12px 18px;background:#8f2530;color:white;cursor:pointer}.danger{background:#efe2d7;color:#6d2b25}table{width:100%;border-collapse:collapse;margin-top:18px;font-size:14px}th,td{text-align:left;border-bottom:1px solid #ead9ca;padding:13px 10px;vertical-align:top}th{color:#7e4036;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.yes{color:#247244;font-weight:700}.no{color:#a03535;font-weight:700}.message{white-space:pre-wrap;max-width:280px}@media(max-width:720px){.table-scroll{overflow-x:auto}table{min-width:720px}}</style></head><body><main class="wrap"><div class="top"><div><p class="muted">Spațiul privat al familiei</p><h1>Răspunsuri invitație</h1></div>${auth ? `<form method="post" style="display:block"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="action" value="logout"><button class="danger" type="submit">Ieșire</button></form>` : ''}</div>${auth ? `<section class="card"><p class="muted">Total răspunsuri: <strong>${rows.length}</strong></p><div class="table-scroll"><table><thead><tr><th>Nume</th><th>Participă</th><th>Persoane</th><th>Mesaj</th><th>Primit la</th></tr></thead><tbody>${table}</tbody></table></div></section>` : `<section class="card"><p class="muted">Introdu parola de administrare pentru a vedea confirmările.</p>${loginMessage}<form method="post"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="action" value="login"><label for="password">Parolă<input id="password" name="password" type="password" autocomplete="current-password" required></label><button type="submit">Deschide tabelul</button></form></section>`}</main></body></html>`;
}

async function handleResults(request, response, session) {
  let error = '';
  if (request.method === 'POST') {
    let data;
    try { data = new URLSearchParams(await readBody(request)); } catch { data = new URLSearchParams(); }
    if (!validCsrf(session, data.get('csrf'))) error = 'Sesiunea a expirat. Reîncarcă pagina.';
    else if (data.get('action') === 'logout') session.authenticated = false;
    else if (data.get('action') === 'login') {
      const supplied = Buffer.from(data.get('password') || '');
      const expected = Buffer.from(resultsPassword);
      if (expected.length > 0 && supplied.length === expected.length && timingSafeEqual(supplied, expected)) session.authenticated = true;
      else { await new Promise((done) => setTimeout(done, 250)); error = 'Parolă incorectă.'; }
    }
  }
  commonHeaders(response);
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.writeHead(200);
  response.end(resultsPage(session, error));
}

function serveMedia(request, response, url) {
  const id = (url.searchParams.get('image') || '').replace(/[^a-z0-9-]/gi, '');
  const filename = imageMap[id];
  if (!filename) return sendNotFound(response);
  const file = resolve(join(filesRoot, filename));
  if (!file.startsWith(resolve(filesRoot) + '\\') || !existsSync(file)) return sendNotFound(response);
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[extname(file).toLowerCase()];
  if (!mime) return sendNotFound(response);
  commonHeaders(response, mime);
  response.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  response.setHeader('Content-Length', statSync(file).size);
  response.writeHead(200);
  response.end(readFileSync(file));
}

function serveAsset(response, pathname) {
  const relativePath = pathname.slice('/assets/'.length);
  const file = resolve(join(publicRoot, 'assets', normalize(relativePath)));
  if (!file.startsWith(resolve(join(publicRoot, 'assets')) + '\\') || !existsSync(file)) return sendNotFound(response);
  const mime = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }[extname(file).toLowerCase()] || 'application/octet-stream';
  commonHeaders(response, mime);
  response.setHeader('Cache-Control', 'public, max-age=86400');
  response.writeHead(200);
  response.end(readFileSync(file));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    const session = getSession(request, response);
    if (pathname === resultsPath) return handleResults(request, response, session);
    if (pathname === '/media.php') return serveMedia(request, response, url);
    if (pathname.startsWith('/assets/')) return serveAsset(response, pathname);
    if (pathname !== '/') return sendNotFound(response);
    if (request.method === 'POST') return handleRsvp(request, response, session);
    const html = readFileSync(join(publicRoot, 'index.html'), 'utf8').replaceAll('__CSRF__', session.csrf);
    commonHeaders(response);
    response.writeHead(200);
    response.end(html);
  } catch (error) {
    console.error(error);
    sendJson(response, { ok: false, message: 'A apărut o eroare internă.' }, 500);
  }
});

server.listen(port, host, () => console.log(`Invitația rulează pe ${host}:${port}`));
