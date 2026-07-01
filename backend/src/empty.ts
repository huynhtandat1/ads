import 'dotenv/config';
import pg from 'pg';
import { seedData, type Row } from './seed.js';

// Reset the app DB to EMPTY for manual testing: clears all business data but
// keeps users + roles so you can still log in (admin/admin) with permissions.
const TARGET = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/krakenocean';

async function main() {
  const pool = new pg.Pool({ connectionString: TARGET });
  const seed = seedData();
  const keep: Record<string, Row[]> = { users: seed.users, roles: seed.roles };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TABLE IF NOT EXISTS entities (collection text NOT NULL, id integer NOT NULL, data jsonb NOT NULL, seq bigserial, PRIMARY KEY (collection,id))');
    await client.query('TRUNCATE entities RESTART IDENTITY');
    for (const [collection, list] of Object.entries(keep)) {
      for (const row of [...list].reverse()) {
        await client.query('INSERT INTO entities (collection,id,data) VALUES ($1,$2,$3)', [collection, row.id, row]);
      }
    }
    await client.query('COMMIT');
    console.log(`[empty] cleared all data; kept users=${keep.users.length}, roles=${keep.roles.length}`);
    console.log(`[empty] DB -> ${new URL(TARGET).pathname.slice(1)} (đăng nhập admin/admin để nhập tay)`);
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((e) => { console.error('[empty] failed:', e.message); process.exit(1); });
