import { getAll, type Row } from '../data/store';
import { round3 } from './format';

export interface Totals { revenue: number; cost: number; profit: number; margin: number; records: number }

// Yiyi là nguồn cung lưu lượng cho nghiệp vụ 神马搜索: toàn bộ "Tổng cộng" Yiyi
// (phải trả + lợi nhuận kênh) là CHI PHÍ của nghiệp vụ đó trong các bảng lợi nhuận.
export const YIYI_BIZ = '神马搜索';

// importMedia là phía CHI của cùng dòng số liệu đã ghi doanh thu ở importAdv
// (ETL/seed/nhập liệu đều đặt importMedia.revenue = số phải thu của link tương ứng)
// → khi gộp nhiều nghiệp vụ chỉ tính phần chi cho media, nếu không doanh thu bị
// đếm hai lần và lợi nhuận bị thổi phồng (spec: Lợi nhuận = Thu NQC − Chi media − Thuế).
// importYiyi: phải khớp Báo cáo Yiyi — tính lại từ quantity × đơn giá/1000,
// làm tròn 3 số lẻ từng phần rồi cộng (không dùng revenue lưu sẵn có thể lệch lịch sử).
export function perfOf(collection: string, r: Row): { revenue: number; cost: number } {
  if (collection === 'importMedia') return { revenue: 0, cost: Number(r.cost) || 0 };
  if (collection === 'importYiyi') {
    const q = Number(r.quantity ?? r.clicks ?? 0) || 0;
    const payable = round3((q * (Number(r.unitPrice) || 0)) / 1000);
    const profit = round3((q * (Number(r.profitUnitPrice) || 0)) / 1000);
    return { revenue: 0, cost: payable + profit };
  }
  return { revenue: Number(r.revenue) || 0, cost: Number(r.cost) || 0 };
}

export function sumPerf(rows: Row[]): Totals {
  const revenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const cost = rows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const profit = revenue - cost;
  return { revenue, cost, profit, margin: revenue ? +((profit / revenue) * 100).toFixed(1) : 0, records: rows.length };
}

export function allPerf(): Row[] {
  return ['importAI', 'importAdv', 'importMedia', 'importYiyi'].flatMap((c) =>
    getAll(c).map((r) => ({ ...r, ...perfOf(c, r) })));
}

export function filterByDate(rows: Row[], from?: string, to?: string): Row[] {
  return rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}
