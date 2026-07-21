import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ETL is additive and cannot truncate or overwrite existing app data', async () => {
  const source = await readFile(new URL('../backend/src/etl.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /TRUNCATE\s+entities/i);
  assert.match(source, /ON\s+CONFLICT\s+DO\s+NOTHING/i);
});

test('quarantine changes the UI only after the server confirms success', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
  });

  let finishRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => { finishRequest = resolve; });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      await requestGate;
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const { getAll, hydrate, quarantine } = await import('../frontend/src/data/store.ts');
  hydrate({ advertisers: [{ id: 1, name: 'A' }], quarantine: [] });

  const moving = quarantine('advertisers', 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(getAll('advertisers').length, 1, 'dữ liệu vẫn hiện trong lúc server chưa xác nhận');
  assert.equal(getAll('quarantine').length, 0);

  finishRequest();
  assert.equal(await moving, true);
  assert.equal(getAll('advertisers').length, 0);
  assert.equal(getAll('quarantine').length, 1);
});

test('failed quarantine keeps the original data visible', async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => new Response(JSON.stringify({ error: 'rejected' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  });

  const { getAll, hydrate, quarantine } = await import('../frontend/src/data/store.ts');
  hydrate({ advertisers: [{ id: 2, name: 'B' }], quarantine: [] });

  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await quarantine('advertisers', 2), false);
  } finally {
    console.error = originalError;
  }
  assert.equal(getAll('advertisers').length, 1);
  assert.equal(getAll('advertisers')[0].name, 'B');
  assert.equal(getAll('quarantine').length, 0);
});
