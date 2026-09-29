import { getAll, effectiveValue, type Row } from '../data/store';
import { hierarchyKey } from './hierarchyFilters';

export interface Totals {
  revenue: number; cost: number;
  /** Lợi nhuận trước thuế (revenue − cost). */
  profit: number;
  /** Thuế = Σ (profit_ngày × suất hiệu lực ngày đó). */
  tax: number;
  /** Lợi nhuận sau thuế (profit − tax), khớp với g4a/g4b để đối chiếu. */
  afterTax: number;
  margin: number;
  records: number;
}

// importMedia là phía CHI của cùng dòng số liệu đã ghi doanh thu ở importAdv
// (ETL/seed/nhập liệu đều đặt importMedia.revenue = số phải thu của link tương ứng)
// → khi gộp nhiều nghiệp vụ chỉ tính phần chi cho media, nếu không doanh thu bị
// đếm hai lần và lợi nhuận bị thổi phồng (spec: Lợi nhuận = Thu NQC − Chi media − Thuế).
const TAX_PCT = 6; // đồng bộ với AggregateReportPage / TotalProfitPage.
export function perfOf(collection: string, r: Row): { revenue: number; cost: number } {
  if (collection === 'importMedia') return { revenue: 0, cost: Number(r.cost) || 0 };
  return { revenue: Number(r.revenue) || 0, cost: Number(r.cost) || 0 };
}

export function sumPerf(rows: Row[]): Totals {
  const revenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const cost = rows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const profit = revenue - cost;
  // Thuế cộng raw theo ngày rồi round 1 lần (đồng bộ g4a/g4b).
  const tax = Math.round(rows.reduce(
    (s, r) => s + (r.date
      ? ((Number(r.revenue) || 0) - (Number(r.cost) || 0))
        * effectiveValue('tax', 0, 'point', String(r.date), TAX_PCT) / 100
      : 0),
    0,
  ) * 1000) / 1000;
  const afterTax = Math.round((profit - tax) * 1000) / 1000;
  return {
    revenue, cost, profit, tax, afterTax,
    // Tỷ suất = LỢI NHUẬN SAU THUẾ / doanh thu (đồng bộ g4b, spec 07-2026) — trước đây
    // dùng lợi nhuận TRƯỚC thuế nên Dashboard lệch với g4b (70% vs 65.8%).
    margin: revenue ? +((afterTax / revenue) * 100).toFixed(1) : 0,
    records: rows.length,
  };
}

export function allPerf(): Row[] {
  return ['importAI', 'importAdv', 'importMedia'].flatMap((c) =>
    getAll(c).map((r) => ({ ...r, ...perfOf(c, r) })));
}

export function filterByDate(rows: Row[], from?: string, to?: string): Row[] {
  return rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}

// 业务 = tên đơn QC của ID QUẢNG CÁO (khóa chung thu↔chi); hồ sơ Media ID có thể ghi lệch
// đơn QC so với adId, dùng r.adOrderId sẽ tách chi media khỏi doanh thu. Trả '' = ẩn khỏi
// báo cáo lợi nhuận khi: đơn QC tắt, HOẶC mọi đơn media cùng tên (≥1 đơn) đều tắt.
export const bizNameOf = (r: Row): string => {
  const adId = r.adIdId != null ? getAll('adIds').find((a) => a.id === r.adIdId) : undefined;
  const orderId = adId?.adOrderId ?? r.adOrderId;
  if (orderId == null) return '';
  const order = getAll('adOrders').find((o) => o.id === orderId);
  if (!order || order.status === false) return '';
  const name = String(order.name);
  const key = hierarchyKey(name);
  const mediaOrders = getAll('mediaOrders').filter((o) => hierarchyKey(o.name) === key);
  if (mediaOrders.length > 0 && mediaOrders.every((o) => o.status === false)) return '';
  return name;
};
