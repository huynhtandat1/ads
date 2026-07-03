export interface BillingInputs {
  unitPrice: number | '';
  traffic: number | '';
  settlement: number | '';
}

// "Số tiền phải thu" theo spec:
//  - Cơ sở = Dữ liệu lưu lượng/Số tiền; KHI CÓ dữ liệu quyết toán thì dùng quyết toán thay thế.
//  - CPM: Đơn giá × cơ sở / 1000 (cost per mille — tính trên mỗi 1000 lượt).
//  - CPC / CPA: Đơn giá × cơ sở.
//  - CPS: Tỷ lệ chia (%) × cơ sở  (đơn giá đóng vai trò tỷ lệ %).

export function receivableOf(type: string, d: BillingInputs): number | null {
  const price = Number(d.unitPrice);
  // Quyết toán = 0 (hoặc rỗng) nghĩa là "chưa quyết toán" → rớt về lưu lượng.
  // Giữ ĐỒNG NHẤT với backend seed/etl (`settlement || traffic`); nếu coi 0 là "đã nhập"
  // thì phải thu sẽ ra 0 cho mọi bản ghi chưa quyết toán, lệch với dữ liệu đã lưu.
  const base = Number(d.settlement) || Number(d.traffic);
  if (!price || !base) return null;
  if (type === 'CPS') return (base * price) / 100;
  if (type === 'CPM') return (price * base) / 1000;
  return price * base;
}
