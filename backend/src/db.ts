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
  await ensureImportNaturalKeyIndexes();
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
  const date = String(r.date ?? '').trim();
  const entityKey = String(entity ?? '').trim();
  if (!date || !entityKey) return null;
  return `${date}|${entityKey}`;
}

// Dọn bản ghi trùng (cùng ngày × cùng ID) đã lọt vào DB trước khi có chống trùng:
// giữ bản id LỚN NHẤT (sửa gần nhất), xóa các bản cũ. Idempotent — chạy mọi lần khởi động.
async function dedupeImports() {
  for (const [collection, idField] of Object.entries(IMPORT_ID_FIELD)) {
    const refCollection = collection === 'importMedia' ? 'mediaIds' : 'adIds';
    const refs = await pool.query<{ id: number; name: string }>(
      `SELECT id, data->>'name' AS name FROM entities WHERE collection = $1`, [refCollection],
    );
    const idByName = new Map(refs.rows.filter((r) => r.name).map((r) => [r.name, r.id] as const));
    const { rows } = await pool.query<{ id: number; data: Row }>(
      'SELECT id, data FROM entities WHERE collection = $1', [collection],
    );
    // Chuẩn hóa cả dữ liệu legacy chỉ có objectId về cùng ID số, để một dòng dùng
    // adIdId/mediaIdId và một dòng dùng tên hiển thị vẫn được nhận diện là trùng.
    const canonicalKey = (data: Row): string | null => {
      const entity = data[idField] ?? idByName.get(String(data.objectId ?? '')) ?? data.objectId;
      if (entity == null || data.date == null) return null;
      return `${String(data.date)}|${String(entity)}`;
    };
    const keepByKey = new Map<string, number>();
    for (const r of rows) {
      const key = canonicalKey(r.data);
      if (!key) continue;
      const prev = keepByKey.get(key);
      if (prev == null || r.id > prev) keepByKey.set(key, r.id);
    }
    const keep = new Set(keepByKey.values());
    const stale = rows.filter((r) => canonicalKey(r.data) && !keep.has(r.id)).map((r) => r.id);
    if (stale.length) {
      await pool.query('DELETE FROM entities WHERE collection = $1 AND id = ANY($2::int[])', [collection, stale]);
      console.log(`[db] dedupe ${collection}: removed ${stale.length} duplicate row(s), kept latest per (date, id)`);
    }
    // Ghi ID số vào bản ghi legacy sau khi đã dọn trùng; các lần ghi sau sẽ luôn
    // đi qua cùng biểu thức unique index, không phụ thuộc tên objectId.
    await pool.query(`
      UPDATE entities AS item
         SET data = jsonb_set(item.data, '{${idField}}', to_jsonb(ref.id), true)
        FROM entities AS ref
       WHERE item.collection = $1
         AND ref.collection = $2
         AND item.data->>'${idField}' IS NULL
         AND item.data->>'objectId' = ref.data->>'name'
    `, [collection, refCollection]);
  }
}

/**
 * Khóa duy nhất ở cấp PostgreSQL: một collection nhập liệu chỉ được có một dòng
 * cho mỗi (ngày × ID). Đây là lớp bảo vệ cuối cùng khi nhiều backend/process ghi
 * đồng thời; khóa RAM trong một process không đủ để ngăn race condition đó.
 *
 * Tạo index sau dedupe để DB cũ có bản ghi trùng vẫn tự nâng cấp được khi khởi động.
 */
async function ensureImportNaturalKeyIndexes() {
  for (const [collection, idField] of Object.entries(IMPORT_ID_FIELD)) {
    const indexName = `entities_${collection.toLowerCase()}_date_entity_uq`;
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${indexName}
      ON entities ((data->>'date'), (COALESCE(data->>'${idField}', data->>'objectId')))
      WHERE collection = '${collection}'
    `);
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

export async function upsertRow(collection: string, row: Row): Promise<Row> {
  const idField = IMPORT_ID_FIELD[collection];
  if (idField && importNaturalKey(collection, row)) {
    const { rows } = await pool.query<{ data: Row }>(
      `INSERT INTO entities (collection, id, data) VALUES ($1, $2, $3)
       ON CONFLICT ((data->>'date'), (COALESCE(data->>'${idField}', data->>'objectId')))
         WHERE collection = '${collection}'
       DO UPDATE SET data = jsonb_set(EXCLUDED.data, '{id}', to_jsonb(entities.id), true)
       RETURNING data`,
      [collection, row.id, row],
    );
    return rows[0].data;
  }
  const { rows } = await pool.query<{ data: Row }>(
    `INSERT INTO entities (collection, id, data) VALUES ($1, $2, $3)
     ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data
     RETURNING data`,
    [collection, row.id, row],
  );
  return rows[0].data;
}

/** Ghi nhiều dòng trong một câu SQL — tránh tạo hàng nghìn request/kết nối khi xác nhận tất cả. */
export async function upsertRows(collection: string, rows: Row[]): Promise<Row[]> {
  if (rows.length === 0) return [];
  const values = rows.map((row) => ({ id: row.id, data: row }));
  const idField = IMPORT_ID_FIELD[collection];
  if (idField) {
    const result = await pool.query<{ data: Row }>(
      `INSERT INTO entities (collection, id, data)
         SELECT $1, item.id, item.data
         FROM jsonb_to_recordset($2::jsonb) AS item(id integer, data jsonb)
       ON CONFLICT ((data->>'date'), (COALESCE(data->>'${idField}', data->>'objectId')))
         WHERE collection = '${collection}'
       DO UPDATE SET data = jsonb_set(EXCLUDED.data, '{id}', to_jsonb(entities.id), true)
       RETURNING data`,
      [collection, JSON.stringify(values)],
    );
    return result.rows.map((r) => r.data);
  }
  const result = await pool.query<{ data: Row }>(
    `INSERT INTO entities (collection, id, data)
       SELECT $1, item.id, item.data
       FROM jsonb_to_recordset($2::jsonb) AS item(id integer, data jsonb)
     ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data
     RETURNING data`,
    [collection, JSON.stringify(values)],
  );
  return result.rows.map((r) => r.data);
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
