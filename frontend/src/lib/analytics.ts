import { getAll, type Row } from '../data/store';

export interface Totals { revenue: number; cost: number; profit: number; margin: number; records: number }

export function sumPerf(rows: Row[]): Totals {
  const revenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const cost = rows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const profit = revenue - cost;
  return { revenue, cost, profit, margin: revenue ? +((profit / revenue) * 100).toFixed(1) : 0, records: rows.length };
}

export function allPerf(): Row[] {
  return [
    ...getAll('importAI'), ...getAll('importAdv'),
    ...getAll('importMedia'), ...getAll('importYiyi'),
  ];
}

export function filterByDate(rows: Row[], from?: string, to?: string): Row[] {
  return rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}
