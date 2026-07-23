import { useSyncExternalStore } from 'react';
import { api, mutationState, waitForMutations } from '../api';

export type Row = Record<string, any> & { id: number };
export type DB = Record<string, Row[]>;

const EMPTY: Row[] = [];

// Local mirror of the backend dataset. The backend is the source of truth
// (auth, RBAC, data-isolation, persistence); this cache keeps the UI snappy
// and synchronous. Mutations update the cache optimistically and are persisted
// to the backend in the background (ids are assigned client-side so references
// stay consistent across the cache and the server).
let db: DB = {};
let dbSignature = JSON.stringify(db);
const listeners = new Set<() => void>();
let actor = 'admin';

function emit() { db = { ...db }; listeners.forEach((l) => l()); }

export function setActor(name: string) { actor = name; }
export function getActor() { return actor; }
export function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function snapshot(): DB { return db; }
export function getAll(c: string): Row[] { return db[c] || EMPTY; }

/** Thay cache khi dữ liệu thực sự đổi, tránh render lại toàn site sau mỗi nhịp polling. */
export function hydrate(d: DB): boolean {
  const next = d || {};
  const signature = JSON.stringify(next);
  if (signature === dbSignature) return false;
  db = next;
  dbSignature = signature;
  emit();
  return true;
}
export function clearDB() { db = {}; dbSignature = JSON.stringify(db); emit(); }

/**
 * Đồng bộ PostgreSQL → cache frontend mà không ghi đè mutation đang chạy.
 * Nếu một thao tác ghi bắt đầu trong lúc request GET đang chờ, bỏ kết quả cũ;
 * nhịp đồng bộ kế tiếp sẽ lấy lại trạng thái mới nhất.
 */
export async function refreshFromServer(): Promise<boolean> {
  const before = mutationState();
  if (before.pending > 0) return false;
  const result = await api.fetchDB();
  const after = mutationState();
  if (after.pending > 0 || after.version !== before.version) return false;
  return hydrate(result.db);
}

/**
 * Đồng bộ khi chuyển trang: chờ lần lưu đang chạy kết thúc rồi lấy snapshot mới ngay.
 * Nếu một mutation khác chen vào lúc GET đang chờ, thử lại để không áp dữ liệu cũ.
 */
export async function refreshOnNavigation(
  shouldApply: () => boolean = () => true,
  maxAttempts = 3,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await waitForMutations();
    if (!shouldApply()) return false;
    const before = mutationState();
    const result = await api.fetchDB();
    if (!shouldApply()) return false;
    const after = mutationState();
    if (after.pending === 0 && after.version === before.version) return hydrate(result.db);
  }
  return false;
}

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

/**
 * Ghi hàng loạt và chỉ cập nhật cache sau khi server xác nhận thành công.
 * Lỗi của cả lô chỉ phát một thông báo, thay vì một toast cho mỗi dòng.
 */
export async function bulkUpsert(c: string, rows: Partial<Row>[]): Promise<Row[]> {
  try {
    const result = await api.bulkUpsert(c, rows);
    const current = db[c] || [];
    const currentIds = new Set(current.map((row) => row.id));
    const savedById = new Map(result.rows.map((row) => [row.id, row] as const));
    const created = result.rows.filter((row) => !currentIds.has(row.id));
    db[c] = [...created, ...current.map((row) => savedById.get(row.id) ?? row)];
    emit();
    appendLog(result.log);
    return result.rows;
  } catch (e) {
    notifySaveError(kindOf(e));
    console.error('bulk upsert failed', e);
    throw e;
  }
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

const isolationMutations = new Set<string>();

// Cô lập (xóa mềm): chỉ đổi cache SAU KHI transaction trên server thành công.
export async function quarantine(c: string, id: number): Promise<boolean> {
  const mutationKey = `quarantine:${c}:${id}`;
  if (isolationMutations.has(mutationKey)) return false;
  const row = (db[c] || []).find((r) => r.id === id);
  if (!row) return false;
  const qrow: Row = {
    id: nextId('quarantine'), collection: c, originalId: row.id,
    label: row.name ?? row.username ?? row.code ?? `#${row.id}`,
    time: new Date().toISOString().slice(0, 19).replace('T', ' '), user: actor, data: row, status: true,
  };
  isolationMutations.add(mutationKey);
  try {
    const result = await api.quarantine(c, id, qrow);
    db.quarantine = [qrow, ...(db.quarantine || [])];
    db[c] = (db[c] || []).filter((r) => r.id !== id);
    emit();
    appendLog(result.log);
    return true;
  } catch (e) {
    notifySaveError(kindOf(e));
    console.error('quarantine failed', e);
    return false;
  } finally {
    isolationMutations.delete(mutationKey);
  }
}

export async function restoreQuarantine(qid: number): Promise<boolean> {
  const mutationKey = `restore:${qid}`;
  if (isolationMutations.has(mutationKey)) return false;
  const q = (db.quarantine || []).find((r) => r.id === qid);
  if (!q) return false;
  isolationMutations.add(mutationKey);
  try {
    const result = await api.restore(qid);
    const exists = (db[q.collection] || []).some((r) => r.id === q.data.id);
    db[q.collection] = exists
      ? (db[q.collection] || []).map((r) => (r.id === q.data.id ? q.data : r))
      : [q.data, ...(db[q.collection] || [])];
    db.quarantine = (db.quarantine || []).filter((r) => r.id !== qid);
    emit();
    appendLog(result.log);
    return true;
  } catch (e) {
    notifySaveError(kindOf(e));
    console.error('restore failed', e);
    return false;
  } finally {
    isolationMutations.delete(mutationKey);
  }
}

export async function purgeQuarantine(qid: number): Promise<boolean> {
  const mutationKey = `purge:${qid}`;
  if (isolationMutations.has(mutationKey)) return false;
  if (!(db.quarantine || []).some((r) => r.id === qid)) return false;
  isolationMutations.add(mutationKey);
  try {
    const result = await api.remove('quarantine', qid);
    db.quarantine = (db.quarantine || []).filter((r) => r.id !== qid);
    emit();
    appendLog(result.log);
    return true;
  } catch (e) {
    notifySaveError(kindOf(e));
    console.error('purge failed', e);
    return false;
  } finally {
    isolationMutations.delete(mutationKey);
  }
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

/**
 * Đặt rate qua endpoint chuyên dụng để backend kiểm tra đúng quyền màn hình +
 * scope entity và ghi rate/base trong một transaction.
 */
export async function setRate(
  entityType: string,
  entityId: number | string,
  field: string,
  value: number,
  effectiveFrom: string,
  screen: string,
): Promise<boolean> {
  const key = rateKey(entityType, entityId, field);
  try {
    const result = await api.setRate(entityType, entityId, field, value, effectiveFrom, screen);
    db.rates = [
      result.rate,
      ...(db.rates || []).filter((row) => !(row.key === key && row.effectiveFrom === effectiveFrom)),
    ];
    if (result.base) {
      db[result.base.collection] = (db[result.base.collection] || [])
        .map((row) => (row.id === result.base!.row.id ? result.base!.row : row));
    }
    emit();
    appendLog(result.log);
    return true;
  } catch (e) {
    notifySaveError(kindOf(e));
    console.error('set rate failed', e);
    return false;
  }
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
