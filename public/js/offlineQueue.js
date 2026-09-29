// offlineQueue.js — antrean transaksi Offline-First untuk HP Karyawan (Dexie.js / IndexedDB)
// Dexie: memakai global `Dexie` jika sudah dimuat, kalau tidak dimuat dari /vendor/dexie.js
// (salin: node_modules/dexie/dist/modern/dexie.mjs  ->  public/vendor/dexie.js)
const Dexie = globalThis.Dexie || (await import('../vendor/dexie.js')).default;

export const STATUS = { ONLINE: 'ONLINE', OFFLINE: 'OFFLINE', SYNCING: 'SYNCING', AUTH_REQUIRED: 'AUTH_REQUIRED' };
const cfg = { getBaseUrl: () => location.origin, getToken: () => null, getUser: () => null, timeoutMs: 2000, pollMs: 10000 };
/** Wajib dipanggil sekali: configure({ getBaseUrl, getToken, getUser, timeoutMs?, pollMs? }) */
export const configure = (o) => Object.assign(cfg, o);

/* ---------- 1. DATABASE LOKAL ---------- */
export const db = new Dexie('PosLocalDB');
db.version(1).stores({
  offline_transactions: '++id, invoice_number, status, created_at', // status: pending | failed (synced = dihapus)
  products_cache: 'id, barcode, name, category',
});

/* ---------- util ---------- */
const pad = (n) => String(n).padStart(2, '0');
const nowStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const newInvoice = () => 'INV' + nowStr().replace(/\D/g, '').slice(2) + (crypto.getRandomValues(new Uint16Array(1))[0] % 900 + 100);
async function fetchT(url, opts = {}, ms = cfg.timeoutMs) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}
export async function isServerReachable() {
  try { return (await fetchT(cfg.getBaseUrl() + '/api/server-info', { cache: 'no-store' })).ok; } catch { return false; }
}
// Hasil: ok | network | auth | rejected (ditolak server: input salah) | server (5xx/404, coba lagi nanti)
async function postTx(body) {
  let r;
  try {
    r = await fetchT(cfg.getBaseUrl() + '/api/transactions', {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (cfg.getToken() || '') },
    });
  } catch { return { kind: 'network' }; }
  let j = null; try { j = await r.json(); } catch {}
  if (r.ok) return j && j.invoice_number ? { kind: 'ok', data: j } : { kind: 'server', error: 'Balasan server tidak valid' };
  if (r.status === 401) return { kind: 'auth' };
  if (r.status >= 500 || r.status === 404) return { kind: 'server', error: j?.error || 'HTTP ' + r.status };
  return { kind: 'rejected', error: j?.error || 'HTTP ' + r.status };
}
function validate(td) {
  if (!td || !Array.isArray(td.items) || !td.items.length) throw new Error('Keranjang kosong');
  for (const i of td.items) if (!i.name || !(+i.price >= 0) || !(Math.floor(+i.qty) > 0)) throw new Error('Item transaksi tidak valid');
}
function buildReceipt(td, invoice, createdAt) { // struk lokal, bentuknya sama dengan balasan server
  const items = td.items.map((i) => { const qty = Math.floor(+i.qty), price = Math.round(+i.price); return { product_name: i.name, selling_price: price, qty, subtotal: price * qty }; });
  const gross = items.reduce((s, i) => s + i.subtotal, 0), discount = Math.min(Math.max(Math.round(+td.discount) || 0, 0), gross), total = gross - discount;
  const cash = (td.payment_method || 'cash') === 'cash' ? Math.round(+td.cash_received) : total;
  if (!(cash >= total)) throw new Error('Uang diterima kurang');
  return { invoice_number: invoice, created_at: new Date(createdAt.replace(' ', 'T')).toLocaleString('id-ID'), cashier: cfg.getUser()?.name || '-', items, discount, total, cash_received: cash, change: cash - total, offline: true };
}

/* ---------- cache barang (untuk jualan & scan barcode saat offline) ---------- */
async function applyLocalStock(items) {
  await db.transaction('rw', db.products_cache, async () => {
    for (const i of items) {
      if (!i.product_id) continue;
      const p = await db.products_cache.get(i.product_id);
      if (p) await db.products_cache.update(i.product_id, { stock: Math.max(0, p.stock - Math.floor(+i.qty)) });
    }
  });
}
export const getCachedProducts = () => db.products_cache.orderBy('name').toArray();
export const findByBarcode = (code) => db.products_cache.where('barcode').equals(String(code).trim()).first();
/** Simpan daftar barang dari server. Stok dikurangi transaksi pending yang belum terkirim. Mengembalikan daftar yang sudah disesuaikan. */
export async function cacheProducts(list) {
  await db.transaction('rw', db.products_cache, async () => {
    await db.products_cache.clear();
    await db.products_cache.bulkPut(list.map((p) => ({ ...p, barcode: p.barcode || '' })));
  });
  for (const t of await db.offline_transactions.where('status').equals('pending').toArray()) await applyLocalStock(t.payload.items);
  return getCachedProducts();
}

/* ---------- 4. STATUS KONEKSI ---------- */
let state = { status: STATUS.ONLINE, pending: 0, failed: 0, message: 'Online — semua data tersinkron' };
let syncing = false, reachable = true, authBlocked = false;
const subs = new Set();
export const getStatus = () => state;
/** onStatusChange(cb) -> cb({status, pending, failed, message}); mengembalikan fungsi unsubscribe */
export function onStatusChange(cb) { subs.add(cb); cb(state); return () => subs.delete(cb); }
async function refreshStatus() {
  const pending = await db.offline_transactions.where('status').equals('pending').count();
  const failed = await db.offline_transactions.where('status').equals('failed').count();
  let status, message;
  if (syncing) { status = STATUS.SYNCING; message = `Menyinkronkan ${pending} transaksi...`; }
  else if (authBlocked && pending) { status = STATUS.AUTH_REQUIRED; message = `${pending} transaksi menunggu — login ulang untuk sinkronisasi`; }
  else if (!reachable || pending) { status = STATUS.OFFLINE; message = pending ? `${pending} Transaksi Offline Pending` : 'Offline — transaksi disimpan lokal'; }
  else { status = STATUS.ONLINE; message = failed ? `Online (${failed} transaksi gagal disinkronkan)` : 'Online — semua data tersinkron'; }
  const next = { status, pending, failed, message };
  if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; subs.forEach((cb) => { try { cb(state); } catch {} }); }
  return state;
}

/* ---------- 2. TRANSACTION ENGINE ---------- */
/** Online -> kirim ke server. Offline/timeout/error -> simpan ke Dexie (pending). Selalu mengembalikan struk yang bisa dicetak.
 *  return { ok:true, mode:'online'|'offline', receipt }.  Melempar Error hanya jika data ditolak server (mis. uang kurang, stok habis). */
export async function processTransaction(td) {
  validate(td);
  const created = nowStr(), invoice = newInvoice();
  const body = { ...td, invoice_number: invoice, client_ref: invoice, created_at: created }; // client_ref = kunci anti-dobel
  if (await isServerReachable()) {
    const r = await postTx(body);
    if (r.kind === 'ok') { reachable = true; await refreshStatus(); return { ok: true, mode: 'online', receipt: r.data }; }
    if (r.kind === 'rejected') throw new Error(r.error);
    if (r.kind === 'auth') authBlocked = true;
  } else reachable = false;
  const receipt = buildReceipt(td, invoice, created);
  await db.offline_transactions.add({ invoice_number: invoice, status: 'pending', created_at: created, payload: body, receipt, attempts: 0, error: null });
  await applyLocalStock(td.items);
  await refreshStatus();
  return { ok: true, mode: 'offline', receipt };
}

/* ---------- 3. AUTO-SYNC ---------- */
/** Kirim semua transaksi pending secara berurutan. Berhasil -> dihapus dari Dexie. */
export async function syncPendingTransactions() {
  if (syncing || !cfg.getToken()) return { sent: 0 };
  syncing = true; let sent = 0;
  try {
    const list = await db.offline_transactions.where('status').equals('pending').sortBy('id');
    if (!list.length) return { sent: 0 };
    await refreshStatus();
    for (const it of list) {
      const r = await postTx({ ...it.payload, offline: true }); // offline:true = penjualan sudah terjadi, jangan ditolak karena stok
      if (r.kind === 'ok') { await db.offline_transactions.delete(it.id); sent++; authBlocked = false; reachable = true; await refreshStatus(); continue; }
      if (r.kind === 'rejected') { await db.offline_transactions.update(it.id, { status: 'failed', error: r.error }); continue; }
      if (r.kind === 'auth') { authBlocked = true; break; }
      await db.offline_transactions.update(it.id, { attempts: (it.attempts || 0) + 1, error: r.error || null });
      if (r.kind === 'network') reachable = false;
      break; // jaga urutan: berhenti, coba lagi di siklus berikutnya
    }
    return { sent };
  } finally { syncing = false; await refreshStatus(); }
}
export async function checkAndSync() {
  reachable = await isServerReachable();
  if (reachable && await db.offline_transactions.where('status').equals('pending').count()) await syncPendingTransactions();
  return refreshStatus();
}
export const getQueue = () => db.offline_transactions.toArray();
export async function retryFailed() { await db.offline_transactions.where('status').equals('failed').modify({ status: 'pending', error: null }); return checkAndSync(); }

let timer = null;
const onOnline = () => checkAndSync(), onOffline = () => { reachable = false; refreshStatus(); };
/** Mulai listener 'online'/'offline' + polling tiap 10 detik */
export function start() {
  if (timer) return;
  addEventListener('online', onOnline); addEventListener('offline', onOffline);
  timer = setInterval(checkAndSync, cfg.pollMs); checkAndSync();
}
export function stop() { clearInterval(timer); timer = null; removeEventListener('online', onOnline); removeEventListener('offline', onOffline); }

/* ===== Contoh transactionData yang valid =====
{
  items: [
    { product_id: 12,   name: 'Indomie Goreng', price: 3500, qty: 5 },   // barang dari database
    { product_id: null, name: 'Jasa fotokopi',  price: 1000, qty: 3 }    // barang manual
  ],
  discount: 2000,          // Rp, boleh 0
  cash_received: 50000,    // wajib >= total jika payment_method 'cash'
  payment_method: 'cash'
}
*/
