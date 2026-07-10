import { getAll, type Row } from '../data/store';

export interface Totals { revenue: number; cost: number; profit: number; margin: number; records: number }

// importMedia là phía CHI của cùng dòng số liệu đã ghi doanh thu ở importAdv
// (ETL/seed/nhập liệu đều đặt importMedia.revenue = số phải thu của link tương ứng)
// → khi gộp nhiều nghiệp vụ chỉ tính phần chi cho media, nếu không doanh thu bị
// đếm hai lần và lợi nhuận bị thổi phồng (spec: Lợi nhuận = Thu NQC − Chi media − Thuế).
export function perfOf(collection: string, r: Row): { revenue: number; cost: number } {
  if (collection === 'importMedia') return { revenue: 0, cost: Number(r.cost) || 0 };
  return { revenue: Number(r.revenue) || 0, cost: Number(r.cost) || 0 };
}

export function sumPerf(rows: Row[]): Totals {
  const revenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const cost = rows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const profit = revenue - cost;
  return { revenue, cost, profit, margin: revenue ? +((profit / revenue) * 100).toFixed(1) : 0, records: rows.length };
}

export function allPerf(): Row[] {
  return ['importAI', 'importAdv', 'importMedia'].flatMap((c) =>
    getAll(c).map((r) => ({ ...r, ...perfOf(c, r) })));
}

export function filterByDate(rows: Row[], from?: string, to?: string): Row[] {
  return rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}
