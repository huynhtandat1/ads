import { getAll, effectiveValue, type Row } from '../data/store';
import { nullableNumber, receivableOf, round3OrNull } from './billing';
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
  // Phân biệt "đã nhập 0" và "chưa nhập" (null): quyết toán đã nhập (kể cả 0) là chuẩn,
  // chưa nhập mới rớt về lưu lượng (spec 07-2026) — nên KHÔNG ép null về 0 ở đây.
  const rawTraffic = !adv || (adv.traffic == null && adv.clicks == null) ? null : Number(adv.traffic ?? adv.clicks ?? 0);
  const rawSettlement = !adv || adv.settlement == null || adv.settlement === '' ? null : Number(adv.settlement);
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
  const scaledTraffic = rawTraffic == null ? '' : (type === 'CPS' ? round3(rawTraffic * coef) : Math.floor(rawTraffic * coef));
  const scaledSettlement = rawSettlement == null ? '' : round3(rawSettlement * coef);
  // Phải trả tính từ base ĐÃ áp hệ số (không nhân hệ số lần nữa). Tính giữ 3 số lẻ,
  // hiển thị money() lo phần rút về 2 số lẻ.
  const receivable = receivableOf(type, { unitPrice, traffic: scaledTraffic, settlement: scaledSettlement });
  const payable = round3OrNull(receivable);          // Số tiền phải trả
  const netPay = payable == null ? null : round3(payable * (accountShare / 100)); // Số tiền thực trả
  // CPS: hai cột Lưu lượng/Số tiền & Quyết toán/Số tiền phía media hiển thị SỐ SAU 分成
  // của NQC (giá trị đơn hàng × tỷ lệ chia NQC %) — media không được đọc giá trị đơn hàng
  // gốc (yêu cầu 07-2026: 广告主数据录入之后，媒体数据应读取分成后金额).
  // Công thức phải trả GIỮ NGUYÊN trên giá trị gốc đã áp hệ số (tính ở trên).
  let traffic = scaledTraffic;
  let settlement = scaledSettlement;
  if (type === 'CPS') {
    const adId = getAll('adIds').find((a) => a.id === m.adIdId);
    const advRate = effectiveValue('adId', m.adIdId, 'unitPrice', cellDate, Number(adId?.unitPrice) || 0);
    if (traffic !== '') traffic = round3(Number(traffic) * (advRate / 100));
    if (settlement !== '') settlement = round3(Number(settlement) * (advRate / 100));
  }
  return { type, traffic, settlement, unitPrice, coef, accountShare, payable, netPay };
}

/** Các trường tiền/tỷ lệ phải khớp, đồng thời phân biệt rõ chưa có dữ liệu và số 0. */
const MONEY_SYNC_FIELDS = ['unitPrice', 'coefficient', 'payable', 'shareRate', 'actual'] as const;

/**
 * Bản ghi importMedia đã lưu có LỆCH với số tính lại từ thượng nguồn không?
 * (NQC sửa lưu lượng/quyết toán, hoặc đơn giá/hệ số/tỷ lệ đổi hiệu lực sau khi lưu.)
 * Dùng cho nút "Lưu" sáng lại ở g3c và tô sáng dòng chưa đồng bộ ở g4d.
 * Lưu lượng/quyết toán so PHÂN BIỆT NULL: "trống" và "0" là hai khái niệm (spec 07-2026) —
 * bản ghi cũ lưu 0 trong khi thượng nguồn trống phải được nhắc lưu lại thành trống.
 */
export function isMediaRecordStale(record: Row): boolean {
  const m = getAll('mediaIds').find((x) => x.id === record.mediaIdId || x.name === record.objectId);
  if (!m) return false; // media ID đã xóa khỏi danh mục → không còn nguồn để so
  const c = calcMediaCell(m, String(record.date || ''));
  if (nullableNumber(record.traffic ?? record.clicks) !== nullableNumber(c.traffic)) return true;
  if (nullableNumber(record.settlement) !== nullableNumber(c.settlement)) return true;
  const fresh: Record<(typeof MONEY_SYNC_FIELDS)[number], number | null> = {
    unitPrice: c.unitPrice, coefficient: c.coef, payable: c.payable, shareRate: c.accountShare, actual: c.netPay,
  };
  return MONEY_SYNC_FIELDS.some((f) => nullableNumber(record[f]) !== fresh[f]);
}
