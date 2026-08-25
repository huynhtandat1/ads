import type { DB, Row } from './data/store';

const BASE = (import.meta.env?.VITE_API_URL as string) || 'http://localhost:8787/api';

let token = localStorage.getItem('ko_token') || '';
let authGeneration = 0;
const protectedRequests = new Set<AbortController>();
let pendingMutations = 0;
let mutationVersion = 0;
const mutationWaiters = new Set<() => void>();

export type DBRevision = string | number;
export type DBFetchResponse =
  | { revision?: DBRevision; unchanged: true; db?: never }
  | { revision?: DBRevision; unchanged?: false; db: DB };

export class ApiError extends Error {
  status: number;
  body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function isUnauthorized(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}

function abortProtectedRequests() {
  const requests = [...protectedRequests];
  protectedRequests.clear();
  requests.forEach((controller) => controller.abort());
}

/** Đổi phiên trước khi hủy request để response cũ không thể đăng xuất phiên mới. */
export function setToken(t: string): number {
  authGeneration++;
  token = t;
  localStorage.setItem('ko_token', t);
  abortProtectedRequests();
  return authGeneration;
}

export function clearToken(): number {
  authGeneration++;
  token = '';
  localStorage.removeItem('ko_token');
  abortProtectedRequests();
  return authGeneration;
}

export function hasToken() { return !!token; }
export function authState() { return { token, generation: authGeneration }; }
export function mutationState() { return { pending: pendingMutations, version: mutationVersion }; }

/** Chờ toàn bộ thao tác ghi hiện tại hoàn tất trước khi tải snapshot mới. */
export function waitForMutations(): Promise<void> {
  if (pendingMutations === 0) return Promise.resolve();
  return new Promise((resolve) => mutationWaiters.add(resolve));
}

async function req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  // Dùng để ngăn một lần đồng bộ nền ghi đè cache trong lúc mutation đang chạy.
  // Login không tính là mutation dữ liệu nghiệp vụ.
  const isProtected = path !== '/login';
  const isMutation = method !== 'GET' && isProtected;
  const requestToken = token;
  const requestGeneration = authGeneration;
  const controller = isProtected ? new AbortController() : null;
  if (controller) protectedRequests.add(controller);
  if (isMutation) { pendingMutations++; mutationVersion++; }
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(isProtected && requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({})) as { error?: string };
      const err = new ApiError(res.status, errorBody.error || `${res.status} ${res.statusText}`, errorBody);
      // Chỉ 401 của chính phiên hiện tại mới được phép đăng xuất. Một /db cũ trả
      // muộn sau lần login kế tiếp không thể xóa token mới.
      if (
        res.status === 401
        && isProtected
        && requestToken
        && requestToken === token
        && requestGeneration === authGeneration
        && !controller?.signal.aborted
        && typeof window !== 'undefined'
      ) {
        window.dispatchEvent(new CustomEvent('ko-unauthorized', {
          detail: { generation: requestGeneration },
        }));
      }
      throw err;
    }
    return res.json();
  } finally {
    if (controller) protectedRequests.delete(controller);
    if (isMutation) {
      pendingMutations--;
      if (pendingMutations === 0) {
        const waiters = [...mutationWaiters];
        mutationWaiters.clear();
        waiters.forEach((resolve) => resolve());
      }
    }
  }
}

export const api = {
  login: (username: string, password: string) =>
    req<{ token: string; user: any }>('POST', '/login', { username, password }),
  fetchDB: (revision?: DBRevision | null) => req<DBFetchResponse>(
    'GET',
    revision == null ? '/db' : `/db?revision=${encodeURIComponent(String(revision))}`,
  ),
  create: (c: string, row: Row) => req<{ log?: Row; row?: Row }>('POST', `/${c}`, row),
  bulkUpsert: (c: string, rows: Partial<Row>[]) =>
    req<{ log?: Row; rows: Row[] }>('POST', `/${c}/bulk`, { rows }),
  update: (c: string, id: number, patch: Partial<Row>) => req<{ log?: Row }>('PUT', `/${c}/${id}`, patch),
  remove: (c: string, id: number) => req<{ log?: Row }>('DELETE', `/${c}/${id}`),
  toggle: (c: string, id: number) => req<{ log?: Row }>('POST', `/${c}/${id}/toggle`),
  setRate: (
    entityType: string,
    entityId: number | string,
    field: string,
    value: number,
    effectiveFrom: string,
    screen: string,
  ) => req<{ rate: Row; base?: { collection: string; row: Row }; log?: Row }>(
    'POST',
    '/rates/set',
    { entityType, entityId, field, value, effectiveFrom, screen },
  ),
  quarantine: (c: string, id: number, qrow: Row) => req<{ log?: Row }>('POST', '/_quarantine', { collection: c, id, qrow }),
  restore: (qid: number) => req<{ log?: Row }>('POST', '/_restore', { qid }),
  settlementPreview: (type: 'adv' | 'media', target: string, from: string, to: string) =>
    req<{ total: number }>('GET', `/settlement/preview?type=${type}&target=${encodeURIComponent(target)}&from=${from}&to=${to}`),
};
