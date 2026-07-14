import { getAll, effectiveValue, type Row } from '../data/store';
import { receivableOf } from './billing';
import { round3 } from './format';

/** Loại hình của 1 media ID: ưu tiên type khai báo, rớt về type của ID quảng cáo nguồn. */
export const mediaTypeOf = (mid: Row): string => mid.type ?? getAll('adIds').find((a) => a.id === mid.adIdId)?.type ?? '-';

/** Bản ghi nhập liệu NQC nguồn của (media ID, ngày) — lưu lượng/quyết toán đọc từ đây. */
export const advSourceOf = (m: Row, cellDate: string) =>
  getAll('importAdv').find((r) => String(r.date) === cellDate && r.adIdId === m.adIdId);

/**
 * Số liệu media HIỆN HÀNH cho (media ID, ngày) — một nguồn logic duy nhất cho cả
 * trang nhập g3c (hiển thị/lưu) lẫn trang truy vấn g4d (so lệch bản ghi đã lưu).
 */
export function calcMediaCell(m: Row, cellDate: string) {
  const adv = advSourceOf(m, cellDate);
  const rawTraffic = adv ? Number(adv.traffic ?? adv.clicks ?? 0) : null;
  const rawSettlement = adv ? Number(adv.settlement ?? 0) : null;
  const type = mediaTypeOf(m);
  const unitPrice = effectiveValue('mediaId', m.id, 'unitPrice', cellDate, Number(m.unitPrice) || 0);
  const coef = effectiveValue('mediaId', m.id, 'coefficient', cellDate, 1);
  const accountShare = effectiveValue('mediaId', m.id, 'profitShare', cellDate, Number(m.profitShare) || 0);
  // Hệ số dữ liệu scale trực tiếp vào DỮ LIỆU:
  //   - Lưu lượng CPM/CPC/CPA = lượt (đếm) → NQC × hệ số, LÀM TRÒN XUỐNG (Math.floor)
  //     không tính lượt chưa đủ (1750×0.85=1487,5 → 1487).
  //   - Lưu lượng CPS = TIỀN (giá trị đơn hàng) → giữ 3 số lẻ (round3) để cộng dồn
  //     chính xác; hiển thị money() rút về 2 số lẻ.
  // Quyết toán là tiền nên cũng giữ 3 số lẻ.
  const traffic = rawTraffic == null ? '' : (type === 'CPS' ? round3(rawTraffic * coef) : Math.floor(rawTraffic * coef));
  const settlement = rawSettlement == null ? '' : round3(rawSettlement * coef);
  // Phải trả tính từ base ĐÃ áp hệ số (không nhân hệ số lần nữa). Tính giữ 3 số lẻ,
  // hiển thị money() lo phần rút về 2 số lẻ.
  const receivable = receivableOf(type, { unitPrice, traffic, settlement });
  const payable = receivable == null ? null : round3(receivable);          // Số tiền phải trả
  const netPay = payable == null ? null : round3(payable * (accountShare / 100)); // Số tiền thực trả
  return { type, traffic, settlement, unitPrice, coef, accountShare, payable, netPay };
}

/** Các trường suy ra từ thượng nguồn phải khớp giữa bản ghi đã lưu và số hiện hành. */
export const MEDIA_SYNC_FIELDS = ['traffic', 'settlement', 'unitPrice', 'coefficient', 'payable', 'shareRate', 'actual'] as const;

/**
 * Bản ghi importMedia đã lưu có LỆCH với số tính lại từ thượng nguồn không?
 * (NQC sửa lưu lượng/quyết toán, hoặc đơn giá/hệ số/tỷ lệ đổi hiệu lực sau khi lưu.)
 * Dùng cho nút "Lưu" sáng lại ở g3c và tô sáng dòng chưa đồng bộ ở g4d.
 */
export function isMediaRecordStale(record: Row): boolean {
  const m = getAll('mediaIds').find((x) => x.id === record.mediaIdId || x.name === record.objectId);
  if (!m) return false; // media ID đã xóa khỏi danh mục → không còn nguồn để so
  const c = calcMediaCell(m, String(record.date || ''));
  const fresh: Record<(typeof MEDIA_SYNC_FIELDS)[number], number> = {
    traffic: Number(c.traffic) || 0, settlement: Number(c.settlement) || 0, unitPrice: c.unitPrice,
    coefficient: c.coef, payable: c.payable ?? 0, shareRate: c.accountShare, actual: c.netPay ?? 0,
  };
  return MEDIA_SYNC_FIELDS.some((f) => Number(record[f] ?? 0) !== fresh[f]);
}
