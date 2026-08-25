import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

type FetchResolver = (response: Response) => void;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('auth generation and database sync regressions', async (t) => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
  });

  class TestCustomEvent<T = unknown> extends Event {
    readonly detail: T;

    constructor(type: string, init?: CustomEventInit<T>) {
      super(type);
      this.detail = init?.detail as T;
    }
  }

  const browserWindow = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow });
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: TestCustomEvent });

  const apiModule = await import('../frontend/src/api.ts');
  const store = await import('../frontend/src/data/store.ts');
  const unauthorizedGenerations: number[] = [];
  browserWindow.addEventListener('ko-unauthorized', (event) => {
    unauthorizedGenerations.push((event as TestCustomEvent<{ generation: number }>).detail.generation);
  });

  await t.test('stale 401 cannot emit unauthorized or disturb the new token', async () => {
    apiModule.setToken('old-token');
    let finishRequest!: FetchResolver;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: () => new Promise<Response>((resolve) => { finishRequest = resolve; }),
    });

    const staleRequest = apiModule.api.fetchDB();
    const newGeneration = apiModule.setToken('new-token');
    finishRequest(jsonResponse({ error: 'unauthorized' }, 401));

    await assert.rejects(staleRequest, (error: unknown) => apiModule.isUnauthorized(error));
    assert.deepEqual(unauthorizedGenerations, []);
    assert.deepEqual(apiModule.authState(), { token: 'new-token', generation: newGeneration });
    assert.equal(storage.get('ko_token'), 'new-token');
  });

  await t.test('401 from the current protected request emits unauthorized once', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => jsonResponse({ error: 'unauthorized' }, 401),
    });
    const currentGeneration = apiModule.authState().generation;

    await assert.rejects(apiModule.api.fetchDB(), (error: unknown) => apiModule.isUnauthorized(error));
    assert.deepEqual(unauthorizedGenerations, [currentGeneration]);
    // The API only reports the event; AuthProvider owns the actual logout decision.
    assert.equal(apiModule.authState().token, 'new-token');
  });

  await t.test('two concurrent sync callers share one GET', async () => {
    apiModule.setToken('sync-token');
    store.clearDB();
    let finishRequest!: FetchResolver;
    let getCount = 0;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: () => {
        getCount++;
        return new Promise<Response>((resolve) => { finishRequest = resolve; });
      },
    });

    const first = store.refreshFromServer();
    const second = store.refreshFromServer();
    assert.equal(getCount, 1);
    finishRequest(jsonResponse({
      revision: 7,
      db: { mediaIds: [{ id: 27, name: 'single-flight' }] },
    }));

    const results = await Promise.all([first, second]);
    assert.equal(results.filter(Boolean).length, 1, 'snapshot chỉ hydrate thay đổi một lần');
    assert.equal(getCount, 1, 'hai caller không tạo hai request /db');
    assert.equal(store.getAll('mediaIds')[0]?.name, 'single-flight');
  });

  await t.test('unchanged response preserves the cache and keeps using conditional revision', async () => {
    const before = store.snapshot();
    const urls: string[] = [];
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (input: string | URL | Request) => {
        urls.push(String(input));
        return jsonResponse({ revision: 7, unchanged: true });
      },
    });

    assert.equal(await store.refreshFromServer(), false);
    assert.strictEqual(store.snapshot(), before, 'unchanged không hydrate hoặc emit cache mới');
    assert.equal(await store.refreshFromServer(), false);
    assert.equal(urls.length, 2);
    assert.ok(urls.every((url) => url.endsWith('/db?revision=7')), 'các lần sau không tải full snapshot');
  });

  await t.test('late successful response cannot repopulate the cache after logout', async () => {
    apiModule.setToken('logout-token');
    store.hydrate({ mediaIds: [{ id: 27, name: 'before-logout' }] }, 7);
    let finishRequest!: FetchResolver;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      // Cố ý không xử lý AbortSignal để mô phỏng response đã ở hàng đợi và vẫn
      // về sau khi phiên bị xóa.
      value: () => new Promise<Response>((resolve) => { finishRequest = resolve; }),
    });

    const staleSync = store.refreshFromServer();
    apiModule.clearToken();
    store.clearDB();
    finishRequest(jsonResponse({
      revision: 8,
      db: { mediaIds: [{ id: 99, name: 'must-not-appear' }] },
    }));

    assert.equal(await staleSync, false);
    assert.deepEqual(store.snapshot(), {});
  });
});

test('backend source keeps the lightweight login and revision contract', async (t) => {
  const source = await readFile(new URL('../backend/src/server.ts', import.meta.url), 'utf8');
  const databaseSource = await readFile(new URL('../backend/src/db.ts', import.meta.url), 'utf8');
  const loginStart = source.indexOf("app.post('/api/login'");
  const dbStart = source.indexOf("app.get('/api/db'", loginStart);
  assert.ok(loginStart >= 0 && dbStart > loginStart, 'không tìm thấy login/db handlers');
  const loginHandler = source.slice(loginStart, dbStart);
  const dbHandler = source.slice(dbStart, source.indexOf('// Settlement preview', dbStart));

  await t.test('login returns token/user without embedding the full database', () => {
    assert.match(loginHandler, /res\.json\(\{\s*token\s*,\s*user\s*\}\)/);
    assert.doesNotMatch(loginHandler, /res\.json\(\{[^)]*\bdb\b[^)]*\}\)/s);
  });

  await t.test('/db supports revision and unchanged responses', () => {
    assert.match(dbHandler, /requestedRevision\s*===\s*revision/);
    assert.match(dbHandler, /\{\s*revision\s*,\s*unchanged:\s*true\s*\}/);
    assert.match(dbHandler, /\{\s*revision\s*,\s*db:/);
  });

  await t.test('the database revision covers external writes and is read with the same MVCC snapshot', () => {
    assert.match(databaseSource, /AFTER\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE\s+ON\s+entities/i);
    assert.match(databaseSource, /FOR\s+EACH\s+STATEMENT/i);
    assert.match(databaseSource, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /loadAllWithRevision\(\)/);
  });

  await t.test('trailing-slash login bypasses the outer mutation lock', () => {
    const middlewareStart = source.indexOf('app.use(async (req, res, next) =>');
    const middlewareEnd = source.indexOf('// Bọc async handler', middlewareStart);
    const middleware = source.slice(middlewareStart, middlewareEnd);
    assert.ok(
      middleware.includes("req.path.replace(/\\/+$/, '')"),
      'middleware phải chuẩn hóa dấu / cuối trước khi nhận diện self-managed route',
    );
    assert.match(middleware, /normalizedPath\s*===\s*['"]\/api\/login['"]/);
    assert.match(middleware, /!selfManagedLock/);
    assert.match(middleware, /writeHead[\s\S]*done\(\)/, 'mutation lock phải nhả trước khi body đi qua mạng');
  });
});
