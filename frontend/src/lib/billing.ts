export interface BillingInputs {
  unitPrice: number | '';
  traffic: number | '';
  settlement: number | '';
}

// "Số tiền phải thu" theo spec:
//  - Cơ sở = Dữ liệu lưu lượng/Số tiền; KHI CÓ dữ liệu quyết toán thì dùng quyết toán thay thế.
//  - CPM: Đơn giá × lưu lượng / 1000.
//  - CPC / CPA: Đơn giá × cơ sở.
//  - CPS: Tỷ lệ chia (%) × cơ sở  (đơn giá đóng vai trò tỷ lệ %).
const has = (v: number | '') => v !== '' && v != null && Number.isFinite(Number(v));

export function receivableOf(type: string, d: BillingInputs): number | null {
  const price = Number(d.unitPrice);
  // Ưu tiên quyết toán KHI ĐÃ NHẬP (kể cả giá trị 0), không rớt về traffic khi settlement = 0.
  const base = has(d.settlement) ? Number(d.settlement) : Number(d.traffic);
  if (!price || !base) return null;
  if (type === 'CPS') return (base * price) / 100;
  if (type === 'CPM') return (price * base) / 1000;
  return price * base;
}
