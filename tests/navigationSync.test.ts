import test from 'node:test';
import assert from 'node:assert/strict';

test('navigation sync waits for the active save, then fetches and hydrates fresh data', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
  });

  let finishSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { finishSave = resolve; });
  const methods: string[] = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (method === 'POST') {
        await saveGate;
        return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ db: { mediaIds: [{ id: 27, name: 'fresh' }] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const [{ api }, { getAll, refreshOnNavigation }] = await Promise.all([
    import('../frontend/src/api.ts'),
    import('../frontend/src/data/store.ts'),
  ]);

  const saving = api.create('mediaIds', { id: 27, name: 'fresh' });
  const syncing = refreshOnNavigation();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(methods, ['POST'], 'không GET snapshot khi thao tác lưu chưa hoàn tất');

  finishSave();
  await saving;
  const changed = await syncing;

  assert.equal(changed, true);
  assert.deepEqual(methods, ['POST', 'GET']);
  assert.equal(getAll('mediaIds')[0]?.name, 'fresh');
});
