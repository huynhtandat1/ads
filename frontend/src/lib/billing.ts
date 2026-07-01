export interface BillingInputs {
  unitPrice: number | '';
  traffic: number | '';
  settlement: number | '';
}

// "Số tiền phải thu" theo spec:
//  - Cơ sở = Dữ liệu lưu lượng/Số tiền; KHI CÓ dữ liệu quyết toán thì dùng quyết toán thay thế.
//  - CPM / CPC / CPA: Đơn giá × cơ sở.
//  - CPS: Tỷ lệ chia (%) × cơ sở  (đơn giá đóng vai trò tỷ lệ %).
export function receivableOf(type: string, d: BillingInputs): number | null {
  const price = Number(d.unitPrice), traffic = Number(d.traffic), settlement = Number(d.settlement);
  const base = settlement || traffic; // có quyết toán → ưu tiên quyết toán
  if (!price || !base) return null;
  return type === 'CPS' ? (base * price) / 100 : price * base;
}
