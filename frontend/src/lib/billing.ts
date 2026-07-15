type Maybe = number | '' | null | undefined;

export interface BillingInputs {
  unitPrice: Maybe;
  traffic: Maybe;
  settlement: Maybe;
}

// Đã nhập = có giá trị số (kể cả 0); rỗng/null/undefined = CHƯA nhập.
const entered = (v: Maybe): v is number => v !== '' && v != null;

/** Chuẩn hóa ô số: rỗng giữ nguyên nghĩa "chưa nhập", không biến thành 0. */
export function nullableNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Làm tròn số tiền nhưng vẫn bảo toàn trạng thái chưa có dữ liệu. */
export function round3OrNull(v: number | null): number | null {
  return v == null ? null : Math.round(v * 1000) / 1000;
}

// "Số tiền phải thu" theo spec (khách chốt 07-2026):
//  - Quyết toán ĐÃ NHẬP (kể cả = 0) là chuẩn — lưu lượng tự vô hiệu; CHƯA nhập → dùng lưu lượng.
//    (Ô còn nút "+数值" là chưa nhập → lưu null, KHÔNG được ép về 0 khi lưu.)
//  - CPM: Đơn giá × cơ sở / 1000  (cost per mille — chuẩn ngành).
//  - CPC / CPA: Đơn giá × cơ sở.
//  - CPS: Tỷ lệ chia (%) × cơ sở  (đơn giá đóng vai trò tỷ lệ %).

export function receivableOf(type: string, d: BillingInputs): number | null {
  const price = Number(d.unitPrice);
  const hasSettlement = entered(d.settlement);
  const base = hasSettlement ? Number(d.settlement) : Number(d.traffic) || 0;
  if (!price) return null;
  if (!hasSettlement && !base) return null; // chưa có cả quyết toán lẫn lưu lượng
  if (type === 'CPS') return (base * price) / 100;
  if (type === 'CPM') return (price * base) / 1000;
  return price * base;
}
