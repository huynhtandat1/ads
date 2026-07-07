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
