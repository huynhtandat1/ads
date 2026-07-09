import { useMemo } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Ngày hôm qua theo giờ local, định dạng YYYY-MM-DD. */
export function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return ymd(d);
}

/**
 * Khoảng tháng theo local: ngày đầu tháng → "đến hôm qua".
 * `offset=0` cho tháng hiện tại, `offset=-1` cho tháng trước.
 */
export function monthRangeUntilYesterday(offset: number): [string, string] {
  const n = new Date();
  const first = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  return [ymd(first), yesterdayStr()];
}

/** Đúng chuỗi ISO `YYYY-MM-DD` nên so sánh string hoạt động như so sánh ngày. */
export const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

// React hook liệt kê mọi ngày trong [from, to] (inclusive). Trả `[]` nếu from > to.
// Dùng cho các trang nhập liệu muốn 1 dòng / ngày cho mỗi đối tượng (ad/media) trong khoảng.
export function useDatesInRange(from: string, to: string): string[] {
  return useMemo(() => {
    const out: string[] = [];
    if (!from || !to || from > to) return out;
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const cur = new Date(fy, fm - 1, fd);
    const end = new Date(ty, tm - 1, td);
    while (cur <= end) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      out.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [from, to]);
}
