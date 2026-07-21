import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { initDb, loadAll, upsertRow, upsertRows, deleteRow, moveRow, importNaturalKey } from './db.js';
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

// ----- Password hashing (scrypt) -----
// Format lưu: "<saltHex>:<hashHex>". Cho phép login vẫn nhận diện được nếu DB
// còn tồn tại bản ghi plaintext cũ (không có ':') → re-hash ngay trong verifyPassword
// để migrate dần, đồng thời vẫn trả 401 nếu plaintext không khớp.
function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(stored: string, plain: string): { ok: boolean; needUpgrade: boolean } {
  if (!stored || !plain) return { ok: false, needUpgrade: false };
  const idx = stored.indexOf(':');
  if (idx < 0) {
    // Bản ghi plaintext cũ (migrate). So khớp thì trả về true + đánh dấu nâng cấp.
    return { ok: stored === plain, needUpgrade: stored === plain };
  }
  const salt = stored.slice(0, idx);
  const hash = Buffer.from(stored.slice(idx + 1), 'hex');
  if (hash.length === 0) return { ok: false, needUpgrade: false };
  const test = scryptSync(plain, salt, hash.length);
  return { ok: timingSafeEqual(hash, test), needUpgrade: false };
}

// ----- Collection -> screen map (for RBAC) -----
const COLLECTION_SCREEN: Record<string, string> = {
  advertisers: 'g1a', adOrders: 'g1b', adIds: 'g1c',
  media: 'g2a', mediaOrders: 'g2b', mediaIds: 'g2c',
  importAI: 'g3a', importAdv: 'g3b', importMedia: 'g3c',
  settleAdv: 'g5a', settleMedia: 'g5b',
  users: 'g7a', roles: 'g7b', logs: 'g6', quarantine: 'g7c',
  // Versioning đơn giá/hệ số/tỷ lệ chia/điểm thuế (RateEditor). Thiếu dòng này thì
  // mọi chỉnh sửa "hiệu lực ngay/về sau" bị server 404 và UI lặng lẽ rollback.
  // Gắn quyền theo g4b (nơi spec đặt nút sửa điểm thuế): OPERATOR sửa được, VIEWER không.
  rates: 'g4b',
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
  mediaIds: ['name'],
};
const normKey = (fields: string[], r: Record<string, unknown>) =>
  fields.map((f) => String(r[f] ?? '').trim().toLowerCase()).join(' ');
function isDuplicate(collection: string, row: Record<string, unknown>, exceptId?: number): boolean {
  const fields = UNIQUE_FIELDS[collection];
  if (!fields) return false;
  const key = normKey(fields, row);
  return (db[collection] || []).some((r) => r.id !== exceptId && normKey(fields, r) === key);
}

function hasInvalidNumber(collection: string, row: Record<string, unknown>): boolean {
  if (['adIds', 'mediaIds', 'rates'].includes(collection) && row.unitPrice != null && row.unitPrice !== '') {
    const unitPrice = Number(row.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return true;
    if (row.type === 'CPS' && unitPrice > 100) return true;
  }
  if (collection === 'mediaIds' && row.profitShare != null && row.profitShare !== '') {
    const profitShare = Number(row.profitShare);
    if (!Number.isFinite(profitShare) || profitShare < 0) return true;
  }
  if (collection === 'rates' && row.value != null && row.value !== '') {
    const value = Number(row.value);
    if (!Number.isFinite(value) || value < 0) return true;
  }
  return false;
}

// ----- Auth -----
interface SessionUser { id: number; username: string; fullName: string; role: string; scope?: string }

function resolvePerms(role: string): '*' | Record<string, Record<string, boolean>> {
  const r = (db.roles || []).find((x) => x.name === role);
  if (!r) return {};
  if (r.permissions === '*') return '*';
  try { return JSON.parse(r.permissions); } catch { return {}; }
}
// Màn quản trị hệ thống — chỉ SUPER_ADMIN được thao tác, BẤT KỂ cấu hình role trong DB.
// Guard cứng ở đây chặn leo quyền kể cả khi dữ liệu role cũ vẫn cấp quyền cho OPERATOR.
const ADMIN_SCREENS = new Set(['g7a', 'g7b', 'g7c']);
function can(user: SessionUser, screen: string, action: string): boolean {
  if (ADMIN_SCREENS.has(screen) && user.role !== 'SUPER_ADMIN') return false;
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
// Chỉ SUPER_ADMIN được xem; user thường (kể cả OPERATOR) nhận mảng rỗng.
const ADMIN_ONLY = new Set(['quarantine']);
// Lọc theo user hiện tại thay vì trả hết.
const USER_SELF = new Set(['users']);
const USER_OWN = new Set(['logs']);

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
    if (ADMIN_ONLY.has(c)) { out[c] = []; continue; }
    if (USER_SELF.has(c)) { out[c] = rows.filter((r) => r.id === user.id); continue; }
    if (USER_OWN.has(c)) { out[c] = rows.filter((r) => r.user === user.username); continue; }
    if (!ADV_SCOPED.has(c)) { out[c] = rows; continue; }
    out[c] = rows.filter((r) => (c === 'advertisers' ? r.id === advId : r.advertiserId === advId));
  }
  return stripSecrets(out);
}

const rateKey = (entityType: string, entityId: number | string, field: string) => `${entityType}:${entityId}:${field}`;

function effectiveValue(source: DB, entityType: string, entityId: number | string, field: string, date: string, fallback: number): number {
  const key = rateKey(entityType, entityId, field);
  let best: Row | undefined;
  for (const r of source.rates || []) {
    if (r.key !== key || r.effectiveFrom > date) continue;
    // Cùng effectiveFrom → lấy bản ghi sau (id lớn hơn), khớp với frontend.
    if (!best || r.effectiveFrom > best.effectiveFrom || (r.effectiveFrom === best.effectiveFrom && Number(r.id) > Number(best.id))) best = r;
  }
  return best ? Number(best.value) : fallback;
}

function mediaActualOf(source: DB, r: Row): number {
  const mediaId = (source.mediaIds || []).find((m) => m.id === r.mediaIdId);
  const fallbackShareRate = Number(mediaId?.profitShare ?? r.shareRate ?? 0) || 0;
  const shareRate = r.mediaIdId != null
    ? effectiveValue(source, 'mediaId', r.mediaIdId, 'profitShare', String(r.date || ''), fallbackShareRate)
    : fallbackShareRate;
  const payable = r.receivable != null ? Number(r.receivable) || 0 : Number(r.payable) || 0;
  if (!payable && r.receivable == null && r.payable == null) return Number(r.actual) || 0;
  // Tính giữ 3 số lẻ (đồng bộ frontend); nơi hiển thị tự rút về 2 số lẻ.
  return Math.round(payable * (shareRate / 100) * 1000) / 1000;
}

// Bộ đếm id log tăng đơn điệu (tránh Math.max(...spread) tràn stack và tránh trùng id).
let logSeq = 5000;

/** Nạp lại nguồn sự thật và giữ bộ đếm log luôn lớn hơn mọi id đã có trong DB. */
async function reloadDbFromStorage() {
  db = await loadAll();
  logSeq = (db.logs || []).reduce((mx, r) => Math.max(mx, Number(r.id) || 0), logSeq);
}

// Cache RAM và PostgreSQL phải đổi như một khối. Xếp tuần tự mutation cùng GET /api/db
// để polling không nạp snapshot cũ đúng lúc một request khác đang ghi/đang cấp id mới.
let dbLockTail = Promise.resolve();
async function acquireDbLock(): Promise<() => void> {
  const previous = dbLockTail;
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  dbLockTail = previous.then(() => current, () => current);
  await previous.catch(() => undefined);
  return release;
}

async function writeLog(user: SessionUser, action: string, object: string): Promise<Row | undefined> {
  const id = ++logSeq;
  const row: Row = {
    id, time: new Date().toISOString().slice(0, 19).replace('T', ' '),
    user: user.username, action, object, ip: '127.0.0.1', detail: '—', status: true,
  };
  try {
    // Audit chỉ xuất hiện trong cache sau khi PostgreSQL đã nhận bản ghi.
    await upsertRow('logs', row);
    db.logs = [row, ...(db.logs || [])];
    return row;
  } catch (e) {
    // Không biến một nghiệp vụ đã lưu thành "thất bại" chỉ vì audit log lỗi.
    // Lỗi vẫn được ghi ra stderr để hệ thống giám sát phát hiện.
    console.error('[audit] cannot persist log:', e);
    return undefined;
  }
}

// ----- App -----
const app = express();
// Giới hạn CORS theo danh sách origin. Dev mặc định cho mọi localhost port vì Vite có thể tự nhảy 5173/5174/...
const ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const allowOrigin = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) return cb(null, true);
  if (ORIGINS.includes('*') || ORIGINS.includes(origin)) return cb(null, true);
  if (!process.env.CORS_ORIGIN && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return cb(null, true);
  return cb(new Error('Not allowed by CORS'));
};
app.use(cors({ origin: allowOrigin }));
app.use(express.json({ limit: '5mb' }));
app.use(async (req, res, next) => {
  const needsLock = req.method !== 'GET' || req.path === '/api/db';
  if (!needsLock) return next();
  // Nếu client ngắt kết nối trong lúc đang chờ lock, không được giữ lock vĩnh viễn.
  let closedWhileWaiting = false;
  const markClosed = () => { closedWhileWaiting = true; };
  res.once('close', markClosed);
  const release = await acquireDbLock();
  res.removeListener('close', markClosed);
  if (closedWhileWaiting || res.destroyed) {
    release();
    return;
  }
  let released = false;
  const done = () => {
    if (released) return;
    released = true;
    release();
  };
  res.once('finish', done);
  res.once('close', done);
  next();
});

// Bọc async handler để lỗi được chuyển sang error middleware thay vì crash im lặng.
const asyncHandler =
  <P = unknown, ResBody = unknown, ReqBody = unknown, ReqQuery = unknown>(
    fn: (req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction) => Promise<unknown>,
  ) =>
  (req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/login', asyncHandler(async (req, res) => {
  // Đăng nhập mới cũng phải nhận dữ liệu vừa được ETL/cập nhật trực tiếp trong PostgreSQL.
  await reloadDbFromStorage();
  const { username, password } = (req.body || {}) as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username/password required' });
  }
  const u = (db.users || []).find((x) => x.username === username && x.status);
  if (!u) return res.status(401).json({ error: 'invalid credentials' });
  const v = verifyPassword(String(u.password || ''), password);
  if (!v.ok) return res.status(401).json({ error: 'invalid credentials' });
  // Bản ghi plaintext cũ → nâng cấp sang hash ngay (migrate dần).
  if (v.needUpgrade) {
    const upgraded = { ...u, password: hashPassword(password) } as Row;
    await upsertRow('users', upgraded);
    Object.assign(u, upgraded);
  }
  const user: SessionUser = { id: u.id, username: u.username, fullName: u.fullName, role: u.role, scope: u.scope ?? 'all' };
  const token = signToken(u.id);
  await writeLog(user, 'login', `user ${user.username}`);
  res.json({ token, user, db: isolate(user) });
}));

app.get('/api/db', auth, asyncHandler(async (req, res) => {
  // PostgreSQL là nguồn sự thật. ETL hoặc tiến trình quản trị có thể cập nhật DB
  // ngoài API đang chạy, vì vậy phải nạp lại trước khi frontend đồng bộ dữ liệu.
  await reloadDbFromStorage();
  res.json({ db: isolate((req as any).user) });
}));

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
      .reduce((s, r) => s + mediaActualOf(scoped, r), 0);
    // Tính giữ 3 số lẻ; frontend hiển thị 2 số lẻ.
    return res.json({ total: Math.round(total * 1000) / 1000 });
  }
  const adv = (scoped.advertisers || []).find((a) => a.name === target);
  const total = (scoped.importAdv || [])
    .filter((r) => (!adv || r.advertiserId === adv.id) && (!from || r.date >= from) && (!to || r.date <= to))
    .reduce((s, r) => s + (Number(r.receivable) || 0), 0);
  res.json({ total: Math.round(total * 1000) / 1000 });
});

// Chỉ cho phép ghi vào các collection đã biết (tránh bơm rác vào các collection tùy ý).
const WRITABLE = new Set(Object.keys(COLLECTION_SCREEN).concat(['settleAdv', 'settleMedia']));
const BULK_IMPORTS = new Set(['importAI', 'importAdv', 'importMedia']);

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
app.post('/api/_quarantine', auth, asyncHandler(async (req, res) => {
  const user = (req as any).user as SessionUser;
  const { collection, id, qrow } = req.body || {};
  if (!WRITABLE.has(collection)) return res.status(404).json({ error: 'unknown collection' });
  const screen = COLLECTION_SCREEN[collection];
  if (screen && !can(user, screen, 'delete')) return res.status(403).json({ error: 'forbidden' });
  const current = (db[collection] || []).find((r) => r.id === Number(id));
  if (!current) return res.status(404).json({ error: 'not found' });
  if (outOfScope(user, collection, current)) return res.status(403).json({ error: 'forbidden' });
  // Validate qrow: phải khớp với bản ghi gốc (id, advertiserId, các field quyết định scope).
  // Tránh user gửi qrow.data "lừa" backend chứa data của scope khác.
  if (!qrow || typeof qrow !== 'object' || qrow.id == null || !Number.isFinite(Number(qrow.id))) {
    return res.status(400).json({ error: 'invalid qrow' });
  }
  const provided = qrow as Row;
  // qrow.id phải là id quarantine mới (do client cấp), qrow.collection phải khớp,
  // qrow.data.id và .originalId phải trỏ đúng về bản ghi gốc.
  if (provided.collection !== collection) return res.status(400).json({ error: 'qrow.collection mismatch' });
  const inner = provided.data && typeof provided.data === 'object' ? (provided.data as Row) : undefined;
  if (!inner || Number(inner.id) !== Number(id)) return res.status(400).json({ error: 'qrow.data.id mismatch' });
  // Từ chối nếu advertiserId trong qrow.data không khớp current (chống leak cross-scope).
  if (ADV_SCOPED.has(collection) && collection !== 'advertisers') {
    if (Number(inner.advertiserId) !== Number(current.advertiserId)) {
      return res.status(403).json({ error: 'forbidden' });
    }
  }
  if (collection === 'advertisers' && Number(inner.id) !== Number(current.id)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  // Không bao giờ copy password/hash vào quarantine (kể cả user bị cô lập).
  const safeQrow: Row = { ...provided, data: { ...inner } };
  delete (safeQrow.data as Row).password;
  // Chặn id trùng trong quarantine (client có thể cấp id đã tồn tại).
  if ((db.quarantine || []).some((r) => r.id === Number(safeQrow.id))) {
    return res.status(409).json({ error: 'quarantine id exists' });
  }
  await moveRow(collection, Number(id), 'quarantine', safeQrow);
  db.quarantine = [safeQrow, ...(db.quarantine || [])];
  db[collection] = (db[collection] || []).filter((r) => r.id !== Number(id));
  const log = await writeLog(user, 'quarantine', `${collection} #${id}`);
  res.json({ ok: true, log });
}));

app.post('/api/_restore', auth, asyncHandler(async (req, res) => {
  const user = (req as any).user as SessionUser;
  if (user.role !== 'SUPER_ADMIN' && !can(user, 'g7c', 'edit')) return res.status(403).json({ error: 'forbidden' });
  const { qid } = req.body || {};
  const q = (db.quarantine || []).find((r) => r.id === Number(qid));
  if (!q) return res.status(404).json({ error: 'not found' });
  await moveRow('quarantine', Number(qid), q.collection, q.data);
  db[q.collection] = [q.data, ...(db[q.collection] || [])];
  db.quarantine = (db.quarantine || []).filter((r) => r.id !== Number(qid));
  const log = await writeLog(user, 'restore', `${q.collection} #${q.originalId}`);
  res.json({ ok: true, log });
}));

// Xác nhận hàng loạt dữ liệu nhập: một request + một câu SQL + một log.
// Không dùng create/update phía client theo vòng lặp vì hàng nghìn request đồng thời
// sẽ làm quá tải server và khiến UI báo thành công trước khi dữ liệu thực sự được lưu.
app.post('/api/:collection/bulk', auth, asyncHandler(async (req, res) => {
  const c = req.params.collection;
  if (!BULK_IMPORTS.has(c)) return res.status(404).json({ error: 'bulk unsupported' });
  const input = req.body?.rows;
  if (!Array.isArray(input) || input.length > 10_000) return res.status(400).json({ error: 'invalid bulk rows' });

  const user = (req as any).user as SessionUser;
  const screen = COLLECTION_SCREEN[c];
  const currentRows = db[c] || [];
  const currentById = new Map(currentRows.map((row) => [Number(row.id), row] as const));
  // Khóa tự nhiên (ngày × ID): client cache cũ gửi create cho record đã tồn tại
  // → server quy về update bản ghi hiện có thay vì tạo bản trùng.
  const byNaturalKey = new Map<string, Row>();
  for (const row of currentRows) {
    const nk = importNaturalKey(c, row);
    if (nk) byNaturalKey.set(nk, row);
  }
  let nextId = currentRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
  const preparedById = new Map<number, Row>();

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return res.status(400).json({ error: 'invalid bulk row' });
    const requestedId = raw.id == null ? undefined : Number(raw.id);
    let current = requestedId == null ? undefined : currentById.get(requestedId);
    if (!current) {
      const nk = importNaturalKey(c, raw);
      if (nk) current = byNaturalKey.get(nk);
    }
    const action = current ? 'edit' : 'create';
    if (screen && !can(user, screen, action)) return res.status(403).json({ error: 'forbidden' });

    const row = { ...(current || {}), ...raw, id: current ? current.id : ++nextId } as Row;
    if (outOfScope(user, c, current) || outOfScope(user, c, row)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (hasInvalidNumber(c, row)) return res.status(400).json({ error: 'invalid number' });
    preparedById.set(row.id, row); // trùng id trong cùng lô → bản sau thắng (tránh lỗi upsert 2 lần 1 id)
    const nk = importNaturalKey(c, row);
    if (nk) byNaturalKey.set(nk, row);
  }

  const prepared = [...preparedById.values()];
  const createdCount = prepared.filter((row) => !currentById.has(row.id)).length;
  const updatedCount = prepared.length - createdCount;
  await upsertRows(c, prepared);
  const savedById = new Map(prepared.map((row) => [row.id, row] as const));
  const created = prepared.filter((row) => !currentById.has(row.id));
  db[c] = [...created, ...currentRows.map((row) => savedById.get(row.id) ?? row)];
  const log = await writeLog(user, 'confirm', `${c}: ${createdCount} create, ${updatedCount} edit`);
  res.json({ ok: true, rows: prepared, log });
}));

app.post('/api/:collection', auth, asyncHandler(async (req, res) => {
  if (!checkRbac(req, res)) return;
  const c = req.params.collection;
  const row = req.body as Row;
  if (row == null || row.id == null || !Number.isFinite(Number(row.id))) return res.status(400).json({ error: 'invalid id' });
  if (outOfScope((req as any).user, c, row)) return res.status(403).json({ error: 'forbidden' });
  if (hasInvalidNumber(c, row)) return res.status(400).json({ error: 'invalid number' });
  // Dữ liệu nhập liệu: cùng (ngày × ID) đã có bản ghi → cache client cũ không thấy nên
  // gửi create; server quy về GHI ĐÈ bản ghi hiện có, không tạo bản trùng thứ hai.
  const naturalKey = importNaturalKey(c, row);
  if (naturalKey) {
    const existing = (db[c] || []).find((r) => r.id !== Number(row.id) && importNaturalKey(c, r) === naturalKey);
    if (existing) {
      const merged = { ...existing, ...row, id: existing.id } as Row;
      await upsertRow(c, merged);
      db[c] = (db[c] || []).map((r) => (r.id === existing.id ? merged : r));
      const log = await writeLog((req as any).user, 'edit', `${c} #${existing.id}`);
      return res.json({ ok: true, row: merged, log });
    }
  }
  // Client tự cấp id từ dữ liệu ĐÃ lọc theo scope nên có thể đụng bản ghi họ không thấy
  // → server cấp lại id kế tiếp (client đồng bộ theo row trả về) thay vì từ chối.
  if ((db[c] || []).some((r) => r.id === Number(row.id))) {
    row.id = (db[c] || []).reduce((mx, r) => Math.max(mx, Number(r.id) || 0), 0) + 1;
  }
  if (isDuplicate(c, row)) return res.status(409).json({ error: 'duplicate' });
  // Tự hash password khi tạo user; bỏ qua nếu đã là hash (chứa ':').
  if (c === 'users' && typeof row.password === 'string' && !row.password.includes(':')) {
    row.password = hashPassword(row.password);
  }
  await upsertRow(c, row);
  db[c] = [row, ...(db[c] || [])];
  const log = await writeLog((req as any).user, 'create', `${c} #${row.id}`);
  res.json({ ok: true, row, log });
}));

app.put('/api/:collection/:id', auth, asyncHandler(async (req, res) => {
  if (!checkRbac(req, res)) return;
  const c = req.params.collection; const id = Number(req.params.id);
  const current = (db[c] || []).find((r) => r.id === id);
  if (!current) return res.status(404).json({ error: 'not found' });
  // Chặn sửa dữ liệu ngoài scope (kiểm cả bản ghi hiện tại lẫn giá trị mới).
  const user = (req as any).user as SessionUser;
  const next = { ...current, ...req.body };
  if (outOfScope(user, c, current) || outOfScope(user, c, next)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (hasInvalidNumber(c, next)) return res.status(400).json({ error: 'invalid number' });
  if (UNIQUE_FIELDS[c] && current && isDuplicate(c, next, id)) {
    return res.status(409).json({ error: 'duplicate' });
  }
  // Users: nếu client gửi password mới (plaintext, không chứa ':') → hash.
  // Bỏ trống hoặc đã là hash → giữ nguyên giá trị cũ.
  const patch = { ...req.body };
  if (c === 'users' && typeof patch.password === 'string') {
    if (patch.password === '' || patch.password.includes(':')) delete patch.password;
    else patch.password = hashPassword(patch.password);
  }
  const updated = { ...current, ...patch } as Row;
  await upsertRow(c, updated);
  db[c] = (db[c] || []).map((r) => (r.id === id ? updated : r));
  const log = await writeLog(user, 'edit', `${c} #${id}`);
  res.json({ ok: true, log });
}));

app.delete('/api/:collection/:id', auth, asyncHandler(async (req, res) => {
  if (!checkRbac(req, res)) return;
  const c = req.params.collection; const id = Number(req.params.id);
  const current = (db[c] || []).find((r) => r.id === id);
  if (!current) return res.status(404).json({ error: 'not found' });
  if (outOfScope((req as any).user, c, current)) return res.status(403).json({ error: 'forbidden' });
  await deleteRow(c, id);
  db[c] = (db[c] || []).filter((r) => r.id !== id);
  const log = await writeLog((req as any).user, 'delete', `${c} #${id}`);
  res.json({ ok: true, log });
}));

app.post('/api/:collection/:id/toggle', auth, asyncHandler(async (req, res) => {
  const user = (req as any).user as SessionUser;
  const c = req.params.collection; const id = Number(req.params.id);
  if (!WRITABLE.has(c)) return res.status(404).json({ error: 'unknown collection' });
  const screen = COLLECTION_SCREEN[c];
  if (screen && !can(user, screen, 'edit')) return res.status(403).json({ error: 'forbidden' });
  const current = (db[c] || []).find((r) => r.id === id);
  if (!current) return res.status(404).json({ error: 'not found' });
  if (outOfScope(user, c, current)) return res.status(403).json({ error: 'forbidden' });
  const toggled = { ...current, status: !current.status } as Row;
  await upsertRow(c, toggled);
  db[c] = (db[c] || []).map((r) => (r.id === id ? toggled : r));
  const log = await writeLog(user, 'edit', `${c} #${id} toggle`);
  res.json({ ok: true, row: toggled, log });
}));

// Error middleware: log lỗi server, trả JSON gọn cho client (tránh treo request).
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[err]', err?.stack || err?.message || err);
  if (res.headersSent) return;
  const status = Number.isInteger(err?.status) ? err.status : 500;
  res.status(status).json({ error: err?.message || 'internal error' });
});

async function main() {
  await initDb();
  await reloadDbFromStorage();
  app.listen(PORT, () => console.log(`KrakenOcean API (PostgreSQL) on http://localhost:${PORT}`));
}
main().catch((e) => {
  console.error('[fatal] cannot start server:', e.message);
  console.error('Kiểm tra PostgreSQL đang chạy và DATABASE_URL đúng (backend/.env).');
  process.exit(1);
});
