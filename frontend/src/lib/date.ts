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

/** Khung thời gian mặc định: từ đầu tháng trước đến hôm qua của tháng hiện tại. */
export function defaultDateRange(): [string, string] {
  return monthRangeUntilYesterday(-1);
}

/** Rút `YYYY-MM-DD` về `DD/MM` (ẩn năm) — cột ngày và dòng tổng hiển thị gọn (spec 07-2026, mục "日/月"). */
export const dayMonth = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Đúng chuỗi ISO `YYYY-MM-DD` nên so sánh string hoạt động như so sánh ngày. */
export const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  if (!from || !to || from > to) return out;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur <= end) {
    out.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function useDatesInRange(from: string, to: string): string[] {
  return useMemo(() => datesInRange(from, to), [from, to]);
}
