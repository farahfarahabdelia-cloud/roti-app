// Server aplikasi penjualan roti. Tanpa dependensi: cukup Node.js 18+.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public');
const SALES = (process.env.SALES || 'Thoriq,Bogel,Balo').split(',').map(s => s.trim()).filter(Boolean);
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = { harga: { panjang: 0, petak: 0 }, pins: {}, laporan: [], secret: crypto.randomBytes(32).toString('hex'), bossPassword: null };
if (fs.existsSync(DB_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
if (!process.env.BOSS_PASSWORD && !db.bossPassword) {
  db.bossPassword = crypto.randomBytes(5).toString('hex');
  console.log('\n>>> Password bos (dibuat otomatis, simpan): ' + db.bossPassword + '\n>>> Ganti dengan environment variable BOSS_PASSWORD.\n');
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
save();

const bossPass = () => process.env.BOSS_PASSWORD || db.bossPassword;
const wib = (t = Date.now()) => new Date(t + 25200000).toISOString().slice(0, 10);
const endOfDay = () => Date.parse(wib() + 'T00:00:00Z') - 25200000 + 86400000;

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function sign(p) {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', db.secret).update(body).digest('base64url');
}
function verify(t, role) {
  if (!t || typeof t !== 'string') return null;
  const [body, sig] = t.split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', db.secret).update(body).digest('base64url');
  if (!same(exp, sig)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() && p.r === role ? p : null;
  } catch { return null; }
}
const hashPin = (name, pin, salt) => crypto.scryptSync(String(pin), salt + name, 32).toString('hex');

// batas percobaan login salah: 5x salah -> kunci 15 menit
const fails = new Map();
function locked(key) { const f = fails.get(key); return f && f.n >= 5 && f.until > Date.now(); }
function fail(key) {
  const f = fails.get(key) || { n: 0, until: 0 };
  if (f.until && f.until < Date.now()) f.n = 0;
  f.n++; f.until = Date.now() + 15 * 60000; fails.set(key, f);
}

const boss = new Set();
function broadcast(obj) { for (const r of boss) r.write('data: ' + JSON.stringify(obj) + '\n\n'); }
setInterval(() => { for (const r of boss) r.write(': ping\n\n'); }, 25000);

function body(req) {
  return new Promise((ok, no) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 100000) { no(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } });
  });
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
const bearer = req => (req.headers.authorization || '').replace(/^Bearer /, '');
const int = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PAGES = { '/': 'index.html', '/sales': 'sales.html', '/boss': 'boss.html' };
function serve(req, res, url) {
  const rel = PAGES[url.pathname] || url.pathname.slice(1);
  const file = path.join(PUB, path.normalize(rel));
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Tidak ditemukan'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (p === '/api/info' && m === 'GET') return send(res, 200, { sales: SALES, harga: db.harga });

  if (p === '/api/login' && m === 'POST') {
    const { name, pin } = await body(req);
    if (!SALES.includes(name)) return send(res, 400, { error: 'Nama sales tidak dikenal' });
    const key = ip + ':' + name;
    if (locked(key)) return send(res, 429, { error: 'Terlalu banyak salah. Coba lagi 15 menit.' });
    const rec = db.pins[name];
    if (!rec) return send(res, 403, { error: 'PIN belum diatur oleh bos' });
    if (!same(hashPin(name, pin || '', rec.salt), rec.hash)) { fail(key); return send(res, 401, { error: 'PIN salah' }); }
    fails.delete(key);
    const exp = endOfDay();
    return send(res, 200, { token: sign({ r: 'sales', n: name, exp }), name, exp });
  }

  if (p === '/api/laporan' && m === 'POST') {
    const s = verify(bearer(req), 'sales');
    if (!s) return send(res, 401, { error: 'Masuk dulu (PIN)' });
    const b = await body(req);
    const toko = String(b.toko || '').trim().slice(0, 80);
    const n = { panjang_laku: int(b.panjang_laku, 100000), panjang_sisa: int(b.panjang_sisa, 100000), petak_laku: int(b.petak_laku, 100000), petak_sisa: int(b.petak_sisa, 100000), uang: int(b.uang, 1e10) };
    if (!toko || Object.values(n).some(v => v === null)) return send(res, 400, { error: 'Data tidak valid' });
    const r = { id: crypto.randomUUID(), sales: s.n, toko, ...n, harusnya: n.panjang_laku * db.harga.panjang + n.petak_laku * db.harga.petak, harga: { ...db.harga }, ts: Date.now(), tgl: wib() };
    db.laporan.push(r); save(); broadcast({ type: 'laporan', laporan: r });
    return send(res, 200, { ok: true, laporan: r });
  }

  if (p === '/api/saya' && m === 'GET') {
    const s = verify(bearer(req), 'sales');
    if (!s) return send(res, 401, { error: 'Masuk dulu (PIN)' });
    return send(res, 200, { laporan: db.laporan.filter(r => r.sales === s.n && r.tgl === wib()).reverse() });
  }

  if (p === '/api/boss/login' && m === 'POST') {
    const { password } = await body(req);
    const key = ip + ':boss';
    if (locked(key)) return send(res, 429, { error: 'Terlalu banyak salah. Coba lagi 15 menit.' });
    if (!same(password || '', bossPass())) { fail(key); return send(res, 401, { error: 'Password salah' }); }
    fails.delete(key);
    return send(res, 200, { token: sign({ r: 'boss', exp: Date.now() + 30 * 86400000 }) });
  }

  if (p.startsWith('/api/boss/')) {
    const tok = p === '/api/boss/stream' ? url.searchParams.get('token') : bearer(req);
    if (!verify(tok, 'boss')) return send(res, 401, { error: 'Masuk sebagai bos dulu' });

    if (p === '/api/boss/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': ok\n\n'); boss.add(res); req.on('close', () => boss.delete(res)); return;
    }
    if (p === '/api/boss/laporan' && m === 'GET') {
      const tgl = url.searchParams.get('tgl');
      let l = db.laporan; if (tgl) l = l.filter(r => r.tgl === tgl);
      return send(res, 200, { laporan: l.slice().reverse().slice(0, 1000), today: wib(), harga: db.harga, pinSet: Object.fromEntries(SALES.map(n => [n, !!db.pins[n]])), sales: SALES });
    }
    if (p === '/api/boss/harga' && m === 'PUT') {
      const b = await body(req), a = int(b.panjang, 1e7), c = int(b.petak, 1e7);
      if (a === null || c === null) return send(res, 400, { error: 'Harga tidak valid' });
      db.harga = { panjang: a, petak: c }; save(); return send(res, 200, { ok: true });
    }
    if (p === '/api/boss/pin' && m === 'PUT') {
      const { name, pin } = await body(req);
      if (!SALES.includes(name) || !/^\d{4}$/.test(String(pin))) return send(res, 400, { error: 'PIN harus 4 angka' });
      const salt = crypto.randomBytes(8).toString('hex');
      db.pins[name] = { salt, hash: hashPin(name, pin, salt) }; save(); return send(res, 200, { ok: true });
    }
    if (p.startsWith('/api/boss/laporan/') && m === 'DELETE') {
      const id = p.split('/').pop(), n = db.laporan.length;
      db.laporan = db.laporan.filter(r => r.id !== id);
      if (db.laporan.length === n) return send(res, 404, { error: 'Tidak ditemukan' });
      save(); broadcast({ type: 'hapus' }); return send(res, 200, { ok: true });
    }
  }
  send(res, 404, { error: 'Tidak ditemukan' });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) await api(req, res, url); else serve(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: 'Permintaan tidak valid' });
  }
}).listen(PORT, () => console.log('Server jalan di port ' + PORT + ' | sales: ' + SALES.join(', ')));
