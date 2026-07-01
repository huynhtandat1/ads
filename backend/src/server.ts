import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createHmac } from 'node:crypto';
import { initDb, loadAll, upsertRow, deleteRow } from './db.js';
import type { DB, Row } from './seed.js';

const PORT = Number(process.env.PORT) || 8787;
const SECRET = process.env.SESSION_SECRET || 'kraken-dev-secret';

// Stateless token: signed user id (survives server restarts — no in-memory session map).
function signToken(userId: number): string {
  const sig = createHmac('sha256', SECRET).update(String(userId)).digest('hex').slice(0, 24);
  return `${userId}.${sig}`;
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
  const id = Number(token.split('.')[0]);
  // Verify signature, then load fresh user from DB (role/scope always current).
  if (!id || signToken(id) !== token) return res.status(401).json({ error: 'unauthorized' });
  const u = (db.users || []).find((x) => x.id === id && x.status);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  (req as any).user = { id: u.id, username: u.username, fullName: u.fullName, role: u.role, scope: u.scope ?? 'all' };
  next();
}

// ----- Data isolation -----
const ADV_SCOPED = new Set(['advertisers', 'adOrders', 'adIds', 'mediaIds', 'importAdv', 'importMedia', 'importAI']);
function isolate(user: SessionUser): DB {
  const scope = user.scope;
  if (user.role === 'SUPER_ADMIN' || !scope || scope === 'all') return db;
  const advId = Number(scope);
  const out: DB = {};
  for (const [c, rows] of Object.entries(db)) {
    if (!ADV_SCOPED.has(c)) { out[c] = rows; continue; }
    out[c] = rows.filter((r) => (c === 'advertisers' ? r.id === advId : r.advertiserId === advId));
  }
  return out;
}

async function writeLog(user: SessionUser, action: string, object: string): Promise<Row> {
  const id = (db.logs?.length ? Math.max(...db.logs.map((r) => r.id)) : 5000) + 1;
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
app.use(cors());
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
  const type = String(req.query.type || 'adv');
  const target = String(req.query.target || '');
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (type === 'media') {
    const media = (db.media || []).find((m) => m.name === target);
    const total = (db.importMedia || [])
      .filter((r) => (!media || r.mediaId === media.id) && (!from || r.date >= from) && (!to || r.date <= to))
      .reduce((s, r) => s + (Number(r.actual) || 0), 0);
    return res.json({ total: Math.round(total) });
  }
  const adv = (db.advertisers || []).find((a) => a.name === target);
  const total = (db.importAdv || [])
    .filter((r) => (!adv || r.advertiserId === adv.id) && (!from || r.date >= from) && (!to || r.date <= to))
    .reduce((s, r) => s + (Number(r.receivable) || 0), 0);
  res.json({ total: Math.round(total) });
});

function checkRbac(req: Request, res: Response): boolean {
  const user = (req as any).user as SessionUser;
  const screen = COLLECTION_SCREEN[req.params.collection];
  const action = ACTION[req.method] || 'edit';
  if (screen && !can(user, screen, action)) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

// ----- Cô lập dữ liệu (quarantine): xóa mềm, chuyển bản ghi vào collection 'quarantine' -----
app.post('/api/_quarantine', auth, async (req, res) => {
  const user = (req as any).user as SessionUser;
  const { collection, id, qrow } = req.body || {};
  const screen = COLLECTION_SCREEN[collection];
  if (screen && !can(user, screen, 'delete')) return res.status(403).json({ error: 'forbidden' });
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
  if (isDuplicate(c, row)) return res.status(409).json({ error: 'duplicate' });
  db[c] = [row, ...(db[c] || [])];
  await upsertRow(c, row);
  const log = await writeLog((req as any).user, 'create', `${c} #${row.id}`);
  res.json({ ok: true, row, log });
});

app.put('/api/:collection/:id', auth, async (req, res) => {
  if (!checkRbac(req, res)) return;
  const c = req.params.collection; const id = Number(req.params.id);
  if (UNIQUE_FIELDS[c]) {
    const current = (db[c] || []).find((r) => r.id === id);
    if (current && isDuplicate(c, { ...current, ...req.body }, id)) return res.status(409).json({ error: 'duplicate' });
  }
  let updated: Row | undefined;
  db[c] = (db[c] || []).map((r) => (r.id === id ? (updated = { ...r, ...req.body }) : r));
  if (updated) await upsertRow(c, updated);
  const log = await writeLog((req as any).user, 'edit', `${c} #${id}`);
  res.json({ ok: true, log });
});

app.delete('/api/:collection/:id', auth, async (req, res) => {
  if (!checkRbac(req, res)) return;
  const c = req.params.collection; const id = Number(req.params.id);
  db[c] = (db[c] || []).filter((r) => r.id !== id);
  await deleteRow(c, id);
  const log = await writeLog((req as any).user, 'delete', `${c} #${id}`);
  res.json({ ok: true, log });
});

app.post('/api/:collection/:id/toggle', auth, async (req, res) => {
  const user = (req as any).user as SessionUser;
  const c = req.params.collection; const id = Number(req.params.id);
  const screen = COLLECTION_SCREEN[c];
  if (screen && !can(user, screen, 'edit')) return res.status(403).json({ error: 'forbidden' });
  let toggled: Row | undefined;
  db[c] = (db[c] || []).map((r) => (r.id === id ? (toggled = { ...r, status: !r.status }) : r));
  if (toggled) await upsertRow(c, toggled);
  const log = await writeLog(user, 'edit', `${c} #${id} toggle`);
  res.json({ ok: true, row: toggled, log });
});

async function main() {
  await initDb();
  db = await loadAll();
  app.listen(PORT, () => console.log(`KrakenOcean API (PostgreSQL) on http://localhost:${PORT}`));
}
main().catch((e) => {
  console.error('[fatal] cannot start server:', e.message);
  console.error('Kiểm tra PostgreSQL đang chạy và DATABASE_URL đúng (backend/.env).');
  process.exit(1);
});
