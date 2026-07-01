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

export async function deleteRow(collection: string, id: number) {
  await pool.query('DELETE FROM entities WHERE collection = $1 AND id = $2', [collection, id]);
}
