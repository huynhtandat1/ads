import type { DB, Row } from './data/store';

const BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:8787/api';

let token = localStorage.getItem('ko_token') || '';
export function setToken(t: string) { token = t; localStorage.setItem('ko_token', t); }
export function clearToken() { token = ''; localStorage.removeItem('ko_token'); }
export function hasToken() { return !!token; }

async function req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // Token hết hiệu lực → buộc đăng nhập lại (tránh thao tác lưu thất bại âm thầm).
    window.dispatchEvent(new CustomEvent('ko-unauthorized'));
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const msg = await res.json().catch(() => ({})) as { error?: string };
    const err: Error & { status?: number; body?: unknown } = new Error(msg.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = msg;
    throw err;
  }
  return res.json();
}

export const api = {
  login: (username: string, password: string) =>
    req<{ token: string; user: any; db: DB }>('POST', '/login', { username, password }),
  fetchDB: () => req<{ db: DB }>('GET', '/db'),
  create: (c: string, row: Row) => req<{ log?: Row; row?: Row }>('POST', `/${c}`, row),
  update: (c: string, id: number, patch: Partial<Row>) => req<{ log?: Row }>('PUT', `/${c}/${id}`, patch),
  remove: (c: string, id: number) => req<{ log?: Row }>('DELETE', `/${c}/${id}`),
  toggle: (c: string, id: number) => req<{ log?: Row }>('POST', `/${c}/${id}/toggle`),
  quarantine: (c: string, id: number, qrow: Row) => req<{ log?: Row }>('POST', '/_quarantine', { collection: c, id, qrow }),
  restore: (qid: number) => req<{ log?: Row }>('POST', '/_restore', { qid }),
  settlementPreview: (type: 'adv' | 'media', target: string, from: string, to: string) =>
    req<{ total: number }>('GET', `/settlement/preview?type=${type}&target=${encodeURIComponent(target)}&from=${from}&to=${to}`),
};
