import pg from 'pg';
import { seedData, type DB, type Row } from './seed.js';

const { Pool } = pg;

const CONN = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/krakenocean';

// Data is stored in a single table keyed by (collection, id) with a jsonb payload,
// preserving the app's flexible per-collection row shapes. `seq` gives ordering
// (newest first, like the previous in-memory store).
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entities (
    collection text   NOT NULL,
    id         integer NOT NULL,
    data       jsonb   NOT NULL,
    seq        bigserial,
    PRIMARY KEY (collection, id)
  );
  CREATE INDEX IF NOT EXISTS entities_collection_seq ON entities (collection, seq DESC);
`;

let pool: pg.Pool;

/** Ensure the target database exists (connect to the maintenance db and CREATE if missing). */
async function ensureDatabase() {
  const url = new URL(CONN);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'krakenocean';
  const adminUrl = new URL(CONN);
  adminUrl.pathname = '/postgres';
  const admin = new Pool({ connectionString: adminUrl.toString() });
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) {
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`[db] created database "${dbName}"`);
    }
  } finally {
    await admin.end();
  }
}

export async function initDb() {
  await ensureDatabase();
  pool = new Pool({ connectionString: CONN });
  await pool.query(SCHEMA);
  await seedIfEmpty();
  await reconcileRoles();
  await dedupeImports();
}

// Khóa tự nhiên của dữ liệu nhập liệu: mỗi (ngày × ID) chỉ có MỘT bản ghi.
// Dùng chung cho chống trùng khi ghi (server.ts) và dọn trùng khi khởi động.
const IMPORT_ID_FIELD: Record<string, string> = {
  importAdv: 'adIdId', importAI: 'adIdId', importMedia: 'mediaIdId',
};
export function importNaturalKey(collection: string, r: Record<string, unknown>): string | null {
  const idField = IMPORT_ID_FIELD[collection];
  if (!idField) return null;
  const entity = r[idField] ?? r.objectId;
  if (entity == null || r.date == null) return null;
  return `${String(r.date)}|${String(entity)}`;
}

// Dọn bản ghi trùng (cùng ngày × cùng ID) đã lọt vào DB trước khi có chống trùng:
// giữ bản id LỚN NHẤT (sửa gần nhất), xóa các bản cũ. Idempotent — chạy mọi lần khởi động.
async function dedupeImports() {
  for (const collection of Object.keys(IMPORT_ID_FIELD)) {
    const { rows } = await pool.query<{ id: number; data: Row }>(
      'SELECT id, data FROM entities WHERE collection = $1', [collection],
    );
    const keepByKey = new Map<string, number>();
    for (const r of rows) {
      const key = importNaturalKey(collection, r.data);
      if (!key) continue;
      const prev = keepByKey.get(key);
      if (prev == null || r.id > prev) keepByKey.set(key, r.id);
    }
    const keep = new Set(keepByKey.values());
    const stale = rows.filter((r) => importNaturalKey(collection, r.data) && !keep.has(r.id)).map((r) => r.id);
    if (!stale.length) continue;
    await pool.query('DELETE FROM entities WHERE collection = $1 AND id = ANY($2::int[])', [collection, stale]);
    console.log(`[db] dedupe ${collection}: removed ${stale.length} duplicate row(s), kept latest per (date, id)`);
  }
}

// Đồng bộ quyền của các role MẶC ĐỊNH về đúng bản seed (nguồn sự thật).
// Idempotent: chạy mọi lần khởi động để các DB cũ (được seed trước khi siết RBAC)
// tự lành — ví dụ OPERATOR từng bị lưu permissions '*' sẽ được hạ về đúng quyền.
// Chỉ động vào role trùng TÊN mặc định; role tuỳ biến do admin tạo không bị đụng.
async function reconcileRoles() {
  const canonical = seedData().roles || [];
  for (const role of canonical) {
    const name = role.name as string;
    const perms = role.permissions as string; // '*' hoặc chuỗi JSON
    await pool.query(
      `UPDATE entities
         SET data = jsonb_set(data, '{permissions}', to_jsonb($2::text), true)
       WHERE collection = 'roles'
         AND data->>'name' = $1
         AND data->>'permissions' IS DISTINCT FROM $2`,
      [name, perms],
    );
  }
}

async function seedIfEmpty() {
  const { rows } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM entities');
  if (Number(rows[0].n) > 0) return;
  const data = seedData();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [collection, list] of Object.entries(data)) {
      // Insert in reverse so the original array order is preserved under seq DESC,
      // while future inserts (higher seq) appear first.
      for (const row of [...list].reverse()) {
        await client.query('INSERT INTO entities (collection, id, data) VALUES ($1, $2, $3)', [collection, row.id, row]);
      }
    }
    await client.query('COMMIT');
    console.log('[db] seeded initial data');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Load the whole dataset grouped by collection (newest first). */
export async function loadAll(): Promise<DB> {
  const { rows } = await pool.query<{ collection: string; data: Row }>(
    'SELECT collection, data FROM entities ORDER BY seq DESC',
  );
  const db: DB = {};
  for (const r of rows) (db[r.collection] ||= []).push(r.data);
  return db;
}

export async function upsertRow(collection: string, row: Row) {
  await pool.query(
    `INSERT INTO entities (collection, id, data) VALUES ($1, $2, $3)
     ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`,
    [collection, row.id, row],
  );
}

/** Ghi nhiều dòng trong một câu SQL — tránh tạo hàng nghìn request/kết nối khi xác nhận tất cả. */
export async function upsertRows(collection: string, rows: Row[]) {
  if (rows.length === 0) return;
  const values = rows.map((row) => ({ id: row.id, data: row }));
  await pool.query(
    `INSERT INTO entities (collection, id, data)
       SELECT $1, item.id, item.data
       FROM jsonb_to_recordset($2::jsonb) AS item(id integer, data jsonb)
     ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`,
    [collection, JSON.stringify(values)],
  );
}

export async function deleteRow(collection: string, id: number) {
  await pool.query('DELETE FROM entities WHERE collection = $1 AND id = $2', [collection, id]);
}

/**
 * Chuyển một bản ghi giữa hai collection trong cùng transaction.
 * Dùng cho cô lập/khôi phục để không thể xảy ra trạng thái đã xóa nguồn nhưng
 * chưa tạo đích (hoặc ngược lại) khi một câu SQL thất bại giữa chừng.
 */
export async function moveRow(
  fromCollection: string,
  fromId: number,
  toCollection: string,
  row: Row,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO entities (collection, id, data) VALUES ($1, $2, $3)
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`,
      [toCollection, row.id, row],
    );
    await client.query('DELETE FROM entities WHERE collection = $1 AND id = $2', [fromCollection, fromId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
