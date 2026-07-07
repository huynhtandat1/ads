import { useSyncExternalStore } from 'react';
import { api } from '../api';

export type Row = Record<string, any> & { id: number };
export type DB = Record<string, Row[]>;

const EMPTY: Row[] = [];

// Local mirror of the backend dataset. The backend is the source of truth
// (auth, RBAC, data-isolation, persistence); this cache keeps the UI snappy
// and synchronous. Mutations update the cache optimistically and are persisted
// to the backend in the background (ids are assigned client-side so references
// stay consistent across the cache and the server).
let db: DB = {};
const listeners = new Set<() => void>();
let actor = 'admin';

function emit() { db = { ...db }; listeners.forEach((l) => l()); }

export function setActor(name: string) { actor = name; }
export function getActor() { return actor; }
export function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function snapshot(): DB { return db; }
export function getAll(c: string): Row[] { return db[c] || EMPTY; }

export function hydrate(d: DB) { db = d || {}; emit(); }
export function clearDB() { db = {}; emit(); }

export function nextId(c: string): number {
  const rows = db[c] || [];
  return rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1;
}

function appendLog(log?: Row) {
  if (log) { db.logs = [log, ...(db.logs || [])]; emit(); }
}

// Báo lỗi lưu cho người dùng (đăng ký từ ToastProvider). Trước đây lỗi server chỉ
// console.warn → bản ghi hiện "Đã lưu" rồi biến mất sau khi tải lại mà không ai biết vì sao.
export type SaveErrorKind = 'duplicate' | 'rejected';
let notifySaveError: (kind: SaveErrorKind) => void = () => {};
export function setSaveErrorNotifier(fn: (kind: SaveErrorKind) => void) { notifySaveError = fn; }
const kindOf = (e: unknown): SaveErrorKind => ((e as any)?.status === 409 ? 'duplicate' : 'rejected');

export function create(c: string, data: Omit<Row, 'id'>): Row {
  const row = { ...data, id: nextId(c) } as Row;
  db[c] = [row, ...(db[c] || [])];
  emit();
  api.create(c, row).then((r) => {
    // id do client cấp có thể đụng bản ghi ngoài scope → server cấp id mới, đồng bộ lại cache.
    if (r.row && Number(r.row.id) !== row.id) {
      db[c] = (db[c] || []).map((x) => (x === row ? { ...x, id: Number(r.row!.id) } : x));
      emit();
    }
    appendLog(r.log);
  }).catch((e) => {
    // Server từ chối (trùng tên, hết quyền, ...) hoặc lỗi mạng → gỡ bản ghi tạm và báo lỗi rõ,
    // tránh bản ghi "ma" hiển thị rồi tự biến mất sau khi tải lại trang.
    const current = (db[c] || []).find((x) => x === row);
    if (current) { db[c] = (db[c] || []).filter((x) => x !== row); emit(); }
    notifySaveError(kindOf(e));
    console.error('create failed', e);
  });
  return row;
}

export function update(c: string, id: number, patch: Partial<Row>) {
  const before = (db[c] || []).find((r) => r.id === id);
  db[c] = (db[c] || []).map((r) => (r.id === id ? { ...r, ...patch } : r));
  emit();
  api.update(c, id, patch).then((r) => appendLog(r.log)).catch((e) => {
    if (before) { db[c] = (db[c] || []).map((r) => (r.id === id ? before : r)); emit(); }
    notifySaveError(kindOf(e));
    console.error('update failed', e);
  });
}

export function remove(c: string, id: number) {
  const removed = (db[c] || []).find((r) => r.id === id);
  db[c] = (db[c] || []).filter((r) => r.id !== id);
  emit();
  api.remove(c, id).then((r) => appendLog(r.log)).catch((e) => {
    if (removed) { db[c] = [removed, ...(db[c] || [])]; emit(); }
    notifySaveError(kindOf(e));
    console.error('delete failed', e);
  });
}

export function toggleStatus(c: string, id: number) {
  db[c] = (db[c] || []).map((r) => (r.id === id ? { ...r, status: !r.status } : r));
  emit();
  api.toggle(c, id).then((r) => appendLog(r.log)).catch((e) => {
    db[c] = (db[c] || []).map((r) => (r.id === id ? { ...r, status: !r.status } : r));
    emit();
    notifySaveError(kindOf(e));
    console.error('toggle failed', e);
  });
}

// Quan hệ phụ thuộc: bản ghi cha -> các collection con tham chiếu tới nó.
const RELATIONS: Record<string, { collection: string; field: string }[]> = {
  advertisers: [
    { collection: 'adOrders', field: 'advertiserId' }, { collection: 'adIds', field: 'advertiserId' },
    { collection: 'mediaIds', field: 'advertiserId' }, { collection: 'importAdv', field: 'advertiserId' },
    { collection: 'importMedia', field: 'advertiserId' },
  ],
  adOrders: [
    { collection: 'adIds', field: 'adOrderId' }, { collection: 'mediaIds', field: 'adOrderId' },
    { collection: 'importAdv', field: 'adOrderId' },
  ],
  adIds: [{ collection: 'mediaIds', field: 'adIdId' }, { collection: 'importAdv', field: 'adIdId' }],
  media: [
    { collection: 'mediaOrders', field: 'mediaId' }, { collection: 'mediaIds', field: 'mediaId' },
    { collection: 'importMedia', field: 'mediaId' },
  ],
  mediaOrders: [{ collection: 'mediaIds', field: 'mediaOrderId' }],
  mediaIds: [{ collection: 'importMedia', field: 'mediaIdId' }],
};

/** Có dữ liệu liên quan ở các collection con không? (để quyết định xóa cứng hay cô lập) */
export function hasRelatedData(c: string, id: number): boolean {
  const rels = RELATIONS[c];
  if (!rels) return false;
  return rels.some((r) => (db[r.collection] || []).some((row) => row[r.field] === id));
}

// Cô lập (xóa mềm): chuyển bản ghi sang collection 'quarantine' thay vì xóa hẳn.
export function quarantine(c: string, id: number) {
  const row = (db[c] || []).find((r) => r.id === id);
  if (!row) return;
  const qrow: Row = {
    id: nextId('quarantine'), collection: c, originalId: row.id,
    label: row.name ?? row.username ?? row.code ?? `#${row.id}`,
    time: new Date().toISOString().slice(0, 19).replace('T', ' '), user: actor, data: row, status: true,
  };
  db.quarantine = [qrow, ...(db.quarantine || [])];
  db[c] = (db[c] || []).filter((r) => r.id !== id);
  emit();
  api.quarantine(c, id, qrow).then((r) => appendLog(r.log)).catch((e) => console.error('quarantine failed', e));
}

export function restoreQuarantine(qid: number) {
  const q = (db.quarantine || []).find((r) => r.id === qid);
  if (!q) return;
  db[q.collection] = [q.data, ...(db[q.collection] || [])];
  db.quarantine = (db.quarantine || []).filter((r) => r.id !== qid);
  emit();
  api.restore(qid).then((r) => appendLog(r.log)).catch((e) => console.error('restore failed', e));
}

export function purgeQuarantine(qid: number) {
  db.quarantine = (db.quarantine || []).filter((r) => r.id !== qid);
  emit();
  api.remove('quarantine', qid).then((r) => appendLog(r.log)).catch((e) => console.error('purge failed', e));
}

// ----- Hiệu lực theo thời gian (versioning) -----
// Mỗi thay đổi giá/tỷ lệ/hệ số/điểm thuế lưu 1 phiên bản trong collection 'rates':
//   { id, key: `${entityType}:${entityId}:${field}`, value, effectiveFrom: 'YYYY-MM-DD' }
const rateKey = (entityType: string, entityId: number | string, field: string) => `${entityType}:${entityId}:${field}`;

/** Giá trị có hiệu lực tại 'date' (phiên bản mới nhất có effectiveFrom <= date), else fallback. */
export function effectiveValue(entityType: string, entityId: number | string, field: string, date: string, fallback: number): number {
  const key = rateKey(entityType, entityId, field);
  let best: Row | null = null;
  for (const r of db.rates || []) {
    if (r.key !== key || r.effectiveFrom > date) continue;
    // Cùng effectiveFrom (vd sửa 2 lần cùng ngày) → lấy bản GHI SAU (id lớn hơn),
    // nếu không sửa lần 2 sẽ bị bản cũ đè lên và hiển thị giá trị trước đó.
    if (!best || r.effectiveFrom > best.effectiveFrom || (r.effectiveFrom === best.effectiveFrom && r.id > best.id)) best = r;
  }
  return best ? Number(best.value) : fallback;
}

/** Đặt giá trị có hiệu lực từ 'effectiveFrom'. Trùng (key, effectiveFrom) thì CẬP NHẬT
 *  bản cũ thay vì tạo mới — tránh sinh rate trùng khiến sửa lần 2 không ăn. */
export function setRate(entityType: string, entityId: number | string, field: string, value: number, effectiveFrom: string) {
  const key = rateKey(entityType, entityId, field);
  const existing = (db.rates || []).find((r) => r.key === key && r.effectiveFrom === effectiveFrom);
  if (existing) update('rates', existing.id, { value });
  else create('rates', { key, value, effectiveFrom });
}

/** Reactive hook: rows of a collection, re-renders on change. */
export function useCollection(c: string): Row[] {
  return useSyncExternalStore(subscribe, () => db[c] || EMPTY);
}

/**
 * Reactive hook: toàn bộ DB, re-render khi bất kỳ collection nào đổi.
 * Dùng khi danh sách collection phụ thuộc props (vd AggregateReportPage) —
 * gọi useCollection trong vòng lặp làm SỐ HOOK thay đổi giữa 2 lần render
 * cùng một instance (chuyển route g4a↔g4b) → React crash "change in order of Hooks".
 */
export function useDB(): DB {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Lookup helper: name of a referenced row by id. */
export function refName(c: string, id: number | undefined, field = 'name'): string {
  if (id == null) return '-';
  const row = (db[c] || []).find((r) => r.id === id);
  return row ? String(row[field]) : '-';
}
