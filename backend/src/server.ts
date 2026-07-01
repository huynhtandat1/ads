import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createHmac } from 'node:crypto';
import { initDb, loadAll, upsertRow, deleteRow } from './db.js';
import type { DB, Row } from './seed.js';

const PORT = Number(process.env.PORT) || 8787;
const IS_PROD = process.env.NODE_ENV === 'production';
// Bí mật ký token BẮT BUỘC ở production (tránh dùng secret mặc định công khai → giả mạo token).
const SECRET = process.env.SESSION_SECRET || (() => {
  if (IS_PROD) {
    console.error('[fatal] SESSION_SECRET chưa được đặt (bắt buộc ở production).');
    process.exit(1);
  }
  console.warn('[warn] SESSION_SECRET chưa đặt — dùng secret dev tạm thời. KHÔNG dùng ở production.');
  return 'kraken-dev-secret';
})();
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS) || 7 * 24 * 60 * 60 * 1000; // 7 ngày

// Stateless token: chữ ký gồm userId + hạn dùng (exp). Không có session map trong RAM.
function signToken(userId: number, exp = Date.now() + TOKEN_TTL_MS): string {
  const sig = createHmac('sha256', SECRET).update(`${userId}.${exp}`).digest('hex').slice(0, 24);
  return `${userId}.${exp}.${sig}`;
}

// Trả về userId nếu token hợp lệ và chưa hết hạn, ngược lại null.
function verifyToken(token: string): number | null {
  const [idStr, expStr, sig] = token.split('.');
  const id = Number(idStr), exp = Number(expStr);
  if (!id || !exp || !sig) return null;
  if (Date.now() > exp) return null;
  if (signToken(id, exp) !== token) return null;
  return id;
}

// In-memory cache (source of truth = PostgreSQL); mutations write through to the DB.
let db: DB = {};

// ----- Collection -> screen map (for RBAC) -----
const COLLECTION_SCREEN: Record<string, string> = {
  advertisers: 'g1a', adOrders: 'g1b', adIds: 'g1c',
  media: 'g2a', mediaOrders: 'g2b', mediaIds: 'g2c',
  importAI: 'g3a', importAdv: 'g3b', importMedia: 'g3c', importYiyi: 'g3d',
  settleAdv: 'g5a', settleMedia: 'g5b',
  users: 'g7a', roles: 'g7b', logs: 'g6', quarantine: 'g7c',
};
const ACTION: Record<string, string> = { POST: 'create', PUT: 'edit', DELETE: 'delete' };

// Collection -> tổ hợp field phải duy nhất (không phân biệt hoa/thường).
// 1 field = duy nhất đơn (tên nhà QC); nhiều field = cặp duy nhất (nhà QC + đơn QC).
const UNIQUE_FIELDS: Record<string, string[]> = {
  advertisers: ['name'],
  adOrders: ['advertiserId', 'name'],
  adIds: ['name'],
  media: ['name'],
  mediaOrders: ['mediaId', 'name'],
};
const normKey = (fields: string[], r: Record<string, unknown>) =>
  fields.map((f) => String(r[f] ?? '').trim().toLowerCase()).join(' ');
function isDuplicate(collection: string, row: Record<string, unknown>, exceptId?: number): boolean {
  const fields = UNIQUE_FIELDS[collection];
  if (!fields) return false;
  const key = normKey(fields, row);
  return (db[collection] || []).some((r) => r.id !== exceptId && normKey(fields, r) === key);
}

// ----- Auth -----
interface SessionUser { id: number; username: string; fullName: string; role: string; scope?: string }

function resolvePerms(role: string): '*' | Record<string, Record<string, boolean>> {
  const r = (db.roles || []).find((x) => x.name === role);
  if (!r) return {};
  if (r.permissions === '*') return '*';
  try { return JSON.parse(r.permissions); } catch { return {}; }
}
function can(user: SessionUser, screen: string, action: string): boolean {
  const perms = resolvePerms(user.role);
  if (perms === '*') return true;
  return Boolean(perms[screen]?.[action]);
}

function auth(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  // Verify chữ ký + hạn dùng, rồi nạp lại user từ DB (role/scope luôn cập nhật).
  const id = verifyToken(token);
  if (!id) return res.status(401).json({ error: 'unauthorized' });
  const u = (db.users || []).find((x) => x.id === id && x.status);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  (req as any).user = { id: u.id, username: u.username, fullName: u.fullName, role: u.role, scope: u.scope ?? 'all' };
  next();
}

// ----- Data isolation -----
const ADV_SCOPED = new Set(['advertisers', 'adOrders', 'adIds', 'mediaIds', 'importAdv', 'importMedia', 'importAI']);

// Không bao giờ gửi mật khẩu ra client.
function stripSecrets(d: DB): DB {
  if (!d.users) return d;
  return { ...d, users: d.users.map(({ password, ...rest }) => rest) };
}

function isolate(user: SessionUser): DB {
  const scope = user.scope;
  if (user.role === 'SUPER_ADMIN' || !scope || scope === 'all') return stripSecrets(db);
  const advId = Number(scope);
  const out: DB = {};
  for (const [c, rows] of Object.entries(db)) {
    if (!ADV_SCOPED.has(c)) { out[c] = rows; continue; }
    out[c] = rows.filter((r) => (c === 'advertisers' ? r.id === advId : r.advertiserId === advId));
  }
  return stripSecrets(out);
}

// Bộ đếm id log tăng đơn điệu (tránh Math.max(...spread) tràn stack và tránh trùng id).
let logSeq = 5000;
async function writeLog(user: SessionUser, action: string, object: string): Promise<Row> {
  const id = ++logSeq;
  const row: Row = {
    id, time: new Date().toISOString().slice(0, 19).replace('T', ' '),
    user: user.username, action, object, ip: '127.0.0.1', detail: '—', status: true,
  };
  db.logs = [row, ...(db.logs || [])];
  await upsertRow('logs', row);
  return row;
}

// ----- App -----
const app = express();
// Giới hạn CORS theo danh sách origin (mặc định frontend dev). Đặt qua CORS_ORIGIN (phân tách bằng dấu phẩy).
const ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());
app.use(cors({ origin: ORIGINS }));
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const u = (db.users || []).find((x) => x.username === username && x.password === password && x.status);
  if (!u) return res.status(401).json({ error: 'invalid credentials' });
  const user: SessionUser = { id: u.id, username: u.username, fullName: u.fullName, role: u.role, scope: u.scope ?? 'all' };
  const token = signToken(u.id);
  await writeLog(user, 'login', `user ${user.username}`);
  res.json({ token, user, db: isolate(user) });
});

app.get('/api/db', auth, (req, res) => {
  res.json({ db: isolate((req as any).user) });
});

// Settlement preview (#2): tổng hợp số tiền theo đối tượng + kỳ.
app.get('/api/settlement/preview', auth, (req, res) => {
  // Tổng hợp trên dataset ĐÃ lọc theo scope của user (không rò rỉ số liệu nhà QC khác).
  const scoped = isolate((req as any).user);
  const type = String(req.query.type || 'adv');
  const target = String(req.query.target || '');
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (type === 'media') {
    const media = (scoped.media || []).find((m) => m.name === target);
    const total = (scoped.importMedia || [])
      .filter((r) => (!media || r.mediaId === media.id) && (!from || r.date >= from) && (!to || r.date <= to))
      .reduce((s, r) => s + (Number(r.actual) || 0), 0);
    return res.json({ total: Math.round(total) });
  }
  const adv = (scoped.advertisers || []).find((a) => a.name === target);
  const total = (scoped.importAdv || [])
    .filter((r) => (!adv || r.advertiserId === adv.id) && (!from || r.date >= from) && (!to || r.date <= to))
    .reduce((s, r) => s + (Number(r.receivable) || 0), 0);
  res.json({ total: Math.round(total) });
});

// Chỉ cho phép ghi vào các collection đã biết (tránh bơm rác vào các collection tùy ý).
const WRITABLE = new Set(Object.keys(COLLECTION_SCREEN).concat(['settleAdv', 'settleMedia']));

function checkRbac(req: Request, res: Response): boolean {
  const user = (req as any).user as SessionUser;
  const c = req.params.collection;
  if (!WRITABLE.has(c)) { res.status(404).json({ error: 'unknown collection' }); return false; }
  const screen = COLLECTION_SCREEN[c];
  const action = ACTION[req.method] || 'edit';
  if (screen && !can(user, screen, action)) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

// Người dùng bị giới hạn scope (1 nhà QC) không được đọc/ghi dữ liệu của nhà QC khác.
function advIdOf(collection: string, row: Record<string, unknown> | undefined): number | undefined {
  if (!row) return undefined;
  return collection === 'advertisers' ? Number(row.id) : Number(row.advertiserId);
}
// Trả về true nếu user KHÔNG được phép chạm vào row này (chặn ghi vượt scope).
function outOfScope(user: SessionUser, collection: string, row: Record<string, unknown> | undefined): boolean {
  if (user.role === 'SUPER_ADMIN' || !user.scope || user.scope === 'all') return false;
  if (!ADV_SCOPED.has(collection)) return false;
  const advId = advIdOf(collection, row);
  return advId !== Number(user.scope);
}

// ----- Cô lập dữ liệu (quarantine): xóa mềm, chuyển bản ghi vào collection 'quarantine' -----
app.post('/api/_quarantine', auth, async (req, res) => {
  const user = (req as any).user as SessionUser;
  const { collection, id, qrow } = req.body || {};
  if (!WRITABLE.has(collection)) return res.status(404).json({ error: 'unknown collection' });
  const screen = COLLECTION_SCREEN[collection];
  if (screen && !can(user, screen, 'delete')) return res.status(403).json({ error: 'forbidden' });
  const current = (db[collection] || []).find((r) => r.id === Number(id));
  if (outOfScope(user, collection, current)) return res.status(403).json({ error: 'forbidden' });
  db.quarantine = [qrow as Row, ...(db.quarantine || [])];
  await upsertRow('quarantine', qrow as Row);
  db[collection] = (db[collection] || []).filter((r) => r.id !== Number(id));
  await deleteRow(collection, Number(id));
  const log = await writeLog(user, 'quarantine', `${collection} #${id}`);
  res.json({ ok: true, log });
});

app.post('/api/_restore', auth, async (req, res) => {
  const user = (req as any).user as SessionUser;
  if (user.role !== 'SUPER_ADMIN' && !can(user, 'g7c', 'edit')) return res.status(403).json({ error: 'forbidden' });
  const { qid } = req.body || {};
  const q = (db.quarantine || []).find((r) => r.id === Number(qid));
  if (!q) return res.status(404).json({ error: 'not found' });
  db[q.collection] = [q.data, ...(db[q.collection] || [])];
  await upsertRow(q.collection, q.data);
  db.quarantine = (db.quarantine || []).filter((r) => r.id !== Number(qid));
  await deleteRow('quarantine', Number(qid));
  const log = await writeLog(user, 'restore', `${q.collection} #${q.originalId}`);
  res.json({ ok: true, log });
});

app.post('/api/:collection', auth, async (req, res) => {
  if (!checkRbac(req, res)) return;
  const c = req.params.collection;
  const row = req.body as Row;
  if (row == null || row.id == null || !Number.isFinite(Number(row.id))) return res.status(400).json({ error: 'invalid id' });
  if (outOfScope((req as any).user, c, row)) return res.status(403).json({ error: 'forbidden' });
  // Không cho ghi đè bản ghi đã tồn tại qua thao tác tạo (client tự cấp id).
  if ((db[c] || []).some((r) => r.id === Number(row.id))) return res.status(409).json({ error: 'id exists' });
  if (isDuplicate(c, row)) return res.status(409).json({ error: 'duplicate' });
  db[c] = [row, ...(db[c] || [])];
  await upsertRow(c, row);
  const log = await writeLog((req as any).user, 'create', `${c} #${row.id}`);
  res.json({ ok: true, row, log });
});

app.put('/api/:collection/:id', auth, async (req, res) => {
  if (!checkRbac(req, res)) return;
  const c = req.params.collection; const id = Number(req.params.id);
  const current = (db[c] || []).find((r) => r.id === id);
  // Chặn sửa dữ liệu ngoài scope (kiểm cả bản ghi hiện tại lẫn giá trị mới).
  const user = (req as any).user as SessionUser;
  if (outOfScope(user, c, current) || outOfScope(user, c, { ...current, ...req.body })) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (UNIQUE_FIELDS[c] && current && isDuplicate(c, { ...current, ...req.body }, id)) {
    return res.status(409).json({ error: 'duplicate' });
  }
  let updated: Row | undefined;
  db[c] = (db[c] || []).map((r) => (r.id === id ? (updated = { ...r, ...req.body }) : r));
  if (updated) await upsertRow(c, updated);
  const log = await writeLog(user, 'edit', `${c} #${id}`);
  res.json({ ok: true, log });
});

app.delete('/api/:collection/:id', auth, async (req, res) => {
  if (!checkRbac(req, res)) return;
  const c = req.params.collection; const id = Number(req.params.id);
  const current = (db[c] || []).find((r) => r.id === id);
  if (outOfScope((req as any).user, c, current)) return res.status(403).json({ error: 'forbidden' });
  db[c] = (db[c] || []).filter((r) => r.id !== id);
  await deleteRow(c, id);
  const log = await writeLog((req as any).user, 'delete', `${c} #${id}`);
  res.json({ ok: true, log });
});

app.post('/api/:collection/:id/toggle', auth, async (req, res) => {
  const user = (req as any).user as SessionUser;
  const c = req.params.collection; const id = Number(req.params.id);
  if (!WRITABLE.has(c)) return res.status(404).json({ error: 'unknown collection' });
  const screen = COLLECTION_SCREEN[c];
  if (screen && !can(user, screen, 'edit')) return res.status(403).json({ error: 'forbidden' });
  const current = (db[c] || []).find((r) => r.id === id);
  if (outOfScope(user, c, current)) return res.status(403).json({ error: 'forbidden' });
  let toggled: Row | undefined;
  db[c] = (db[c] || []).map((r) => (r.id === id ? (toggled = { ...r, status: !r.status }) : r));
  if (toggled) await upsertRow(c, toggled);
  const log = await writeLog(user, 'edit', `${c} #${id} toggle`);
  res.json({ ok: true, row: toggled, log });
});

async function main() {
  await initDb();
  db = await loadAll();
  // Khởi tạo bộ đếm id log từ dữ liệu hiện có (dùng reduce, không spread).
  logSeq = (db.logs || []).reduce((mx, r) => Math.max(mx, Number(r.id) || 0), 5000);
  app.listen(PORT, () => console.log(`KrakenOcean API (PostgreSQL) on http://localhost:${PORT}`));
}
main().catch((e) => {
  console.error('[fatal] cannot start server:', e.message);
  console.error('Kiểm tra PostgreSQL đang chạy và DATABASE_URL đúng (backend/.env).');
  process.exit(1);
});
