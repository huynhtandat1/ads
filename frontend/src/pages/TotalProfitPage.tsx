import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { effectiveValue, getAll, useDB, type Row } from '../data/store';
import { exportCSV } from '../lib/export';
import { IconDownload } from '../components/icons';
import { monthRangeUntilYesterday, yesterdayStr, ymd } from '../lib/date';

// "Lợi nhuận tổng" (spec g4a): 2 bảng theo đặc tả PDF §Bảng tổng lợi nhuận
//   1. Lợi nhuận mỗi NGÀY theo từng nghiệp vụ
//   2. Tổng lợi nhuận THÁNG theo từng nghiệp vụ (đã có sẵn, nay trừ thuế)
// Thuế 6% theo versioning `tax:0:point` — đồng bộ với g4b (AggregateReportPage).
const TAX_PCT = 6;
const COLLECTIONS = ['importAI', 'importAdv', 'importMedia', 'importYiyi'];
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

interface DailyCell { biz: string; date: string; profit: number; tax: number }
interface BizRow { biz: string; today: number; month: number; monthTax: number }

const bizNameOf = (r: Row): string => {
  if (!r.adOrderId) return '';
  const order = getAll('adOrders').find((o) => o.id === r.adOrderId);
  return order ? String(order.name) : '';
};

export function TotalProfitPage() {
  const { t } = useTranslation();
  useDB();

  const [from, setFrom] = useState(`${yesterdayStr().slice(0, 7)}-01`);
  const [to, setTo] = useState(yesterdayStr());

  const pickThisMonth = () => { const [f, tt] = monthRangeUntilYesterday(0); setFrom(f); setTo(tt); };
  const pickLastMonth = () => { const [f, tt] = monthRangeUntilYesterday(-1); setFrom(f); setTo(tt); };

  const todayStr = ymd(new Date());

  // Bảng 1 — Lợi nhuận MỖI NGÀY × NGHIỆP VỤ, sort ngày tăng dần.
  const daily = useMemo<DailyCell[]>(() => {
    const src = COLLECTIONS.flatMap((c) => getAll(c));
    const map = new Map<string, { profit: number; tax: number }>();
    for (const r of src) {
      const biz = bizNameOf(r);
      if (!biz) continue;
      const date = String(r.date || '');
      if (from && date < from) continue;
      if (to && date > to) continue;
      const p = (Number(r.revenue) || 0) - (Number(r.cost) || 0);
      const key = `${biz}|${date}`;
      const g = map.get(key) || { profit: 0, tax: 0 };
      g.profit += p;
      const taxPct = effectiveValue('tax', 0, 'point', date, TAX_PCT);
      g.tax += Math.round((p * taxPct) / 100);
      map.set(key, g);
    }
    return Array.from(map.entries())
      .map(([k, g]) => {
        const [biz, date] = k.split('|');
        return { biz, date, profit: g.profit, tax: g.tax };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.biz.localeCompare(b.biz));
  }, [from, to]);

  // Bảng 2 — Tổng lợi nhuận THÁNG theo nghiệp vụ. Profit đã TRỪ thuế (đồng bộ g4b + spec).
  const rows = useMemo<BizRow[]>(() => {
    const src = COLLECTIONS.flatMap((c) => getAll(c));
    const map = new Map<string, { today: number; month: number; monthTax: number }>();
    for (const r of src) {
      const biz = bizNameOf(r);
      if (!biz) continue;
      const date = String(r.date || '');
      if (from && date < from) continue;
      if (to && date > to) continue;
      const p = (Number(r.revenue) || 0) - (Number(r.cost) || 0);
      const taxPct = effectiveValue('tax', 0, 'point', date, TAX_PCT);
      const tax = Math.round((p * taxPct) / 100);
      const g = map.get(biz) || { today: 0, month: 0, monthTax: 0 };
      g.month += p;
      g.monthTax += tax;
      if (date === to) g.today += p - tax;
      map.set(biz, g);
    }
    return Array.from(map.entries())
      .map(([biz, g]) => ({ biz, today: g.today, month: g.month - g.monthTax, monthTax: g.monthTax }))
      .sort((a, b) => b.month - a.month);
  }, [from, to]);

  const totals = rows.reduce((s, r) => ({
    today: s.today + r.today, month: s.month + r.month, monthTax: s.monthTax + r.monthTax,
  }), { today: 0, month: 0, monthTax: 0 });

  const dailyTotal = daily.reduce((s, d) => ({
    profit: s.profit + d.profit,
    tax: s.tax + d.tax,
  }), { profit: 0, tax: 0 });

  // Ngày duy nhất trong kỳ (cho bảng 1 làm header cột).
  const dailyDates = Array.from(new Set(daily.map((d) => d.date))).sort();
  const dailyBizs = Array.from(new Set(daily.map((d) => d.biz))).sort((a, b) => a.localeCompare(b));

  // Pivot: cell[date][biz] = { profit, tax }
  const cellPivot = (() => {
    const m = new Map<string, { profit: number; tax: number }>();
    for (const d of daily) {
      const k = `${d.date}|${d.biz}`;
      m.set(k, { profit: d.profit, tax: d.tax });
    }
    return m;
  })();

  const HEADERS = [
    t('col.stt'),
    t('report.business'),
    t('report.profitToday'),
    t('col.tax'),
    t('report.profitMonth'),
  ];

  const doExport = () => {
    const data = rows.map((r, i) => [i + 1, r.biz, r.today, r.monthTax, r.month]);
    exportCSV('total_profit', HEADERS, data);
  };

  const sel = "h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-200";

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs font-semibold tracking-widest text-cyan-500">{t('report.eyebrow')}</div>
        <h1 className="text-xl font-bold text-gray-800">{t('menu.g4a')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {t('col.date')}: <span className="font-medium text-gray-700">{from} ~ {to}</span>
          <span className="ml-2 text-gray-400">({t('report.eyebrow')} · thuế {effectiveValue('tax', 0, 'point', todayStr, TAX_PCT)}%)</span>
        </p>
      </div>

      {/* Toolbar (dùng chung cho cả 2 bảng) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('col.date')}</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={sel} />
              <span className="text-gray-400">—</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={sel} />
            </div>
          </div>
          <button onClick={pickThisMonth} className="h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">{t('report.thisMonth')}</button>
          <button onClick={pickLastMonth} className="h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">{t('report.lastMonth')}</button>
        </div>
        <div className="flex-1" />
        <button onClick={doExport} disabled={rows.length === 0}
          className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50">
          <IconDownload width={16} height={16} /> {t('report.exportExcel')}
        </button>
      </div>

      {/* Bảng 2 — Tổng lợi nhuận THÁNG theo nghiệp vụ (đã trừ thuế) */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-4">
        <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('report.monthlyByBiz')}
        </div>
        <div className="overflow-auto max-h-[calc(50vh-100px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                {HEADERS.map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide whitespace-nowrap ${i > 1 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={HEADERS.length} className="px-3 py-16 text-center text-gray-400">{t('common.noData')}</td></tr>
              ) : (
                <>
                  <tr className="bg-brand-dark2 text-white font-semibold">
                    <td colSpan={2} className="px-3 py-2">Σ {t('report.grandTotal')} · {rows.length}</td>
                    <td className={`px-3 py-2 text-right ${totals.today >= 0 ? 'text-cyan-300' : 'text-rose-300'}`}>{money(totals.today)}</td>
                    <td className="px-3 py-2 text-right text-rose-300">{money(totals.monthTax)}</td>
                    <td className={`px-3 py-2 text-right ${totals.month >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(totals.month)}</td>
                  </tr>
                  {rows.map((r, i) => (
                    <tr key={r.biz} className="border-b border-gray-50 hover:bg-cyan-50/30">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{r.biz}</td>
                      <td className={`px-3 py-2 text-right font-medium ${r.today >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{money(r.today)}</td>
                      <td className="px-3 py-2 text-right text-rose-500">{money(r.monthTax)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${r.month >= 0 ? 'text-emerald-700' : 'text-rose-500'}`}>{money(r.month)}</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bảng 1 — Lợi nhuận mỗi NGÀY theo từng nghiệp vụ (spec §Bảng tổng lợi nhuận) */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('report.dailyByBiz')}
        </div>
        <div className="overflow-auto max-h-[calc(50vh-100px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide whitespace-nowrap">{t('col.date')}</th>
                {dailyBizs.map((b) => (
                  <th key={b} className="px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide text-right whitespace-nowrap">{b}</th>
                ))}
                <th className="px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide text-right whitespace-nowrap">{t('col.tax')}</th>
                <th className="px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide text-right whitespace-nowrap">{t('col.profit')}</th>
              </tr>
            </thead>
            <tbody>
              {daily.length === 0 ? (
                <tr><td colSpan={dailyBizs.length + 3} className="px-3 py-16 text-center text-gray-400">{t('common.noData')}</td></tr>
              ) : (
                <>
                  {/* Dòng tổng của cả kỳ */}
                  <tr className="bg-brand-dark2 text-white font-semibold">
                    <td className="px-3 py-2 whitespace-nowrap">Σ</td>
                    {dailyBizs.map((b) => {
                      const v = daily.filter((d) => d.biz === b).reduce((s, d) => s + d.profit, 0);
                      return (
                        <td key={b} className={`px-3 py-2 text-right ${v >= 0 ? 'text-cyan-300' : 'text-rose-300'}`}>
                          {money(v)}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right text-rose-300">{money(dailyTotal.tax)}</td>
                    <td className={`px-3 py-2 text-right ${dailyTotal.profit - dailyTotal.tax >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {money(dailyTotal.profit - dailyTotal.tax)}
                    </td>
                  </tr>
                  {dailyDates.map((date) => {
                    const rowTax = daily.filter((d) => d.date === date).reduce((s, d) => s + d.tax, 0);
                    const rowProfit = daily.filter((d) => d.date === date).reduce((s, d) => s + d.profit, 0);
                    return (
                      <tr key={date} className="border-b border-gray-50 hover:bg-cyan-50/30">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{date}</td>
                        {dailyBizs.map((b) => {
                          const v = cellPivot.get(`${date}|${b}`)?.profit ?? 0;
                          if (!v) return <td key={b} className="px-3 py-2 text-right text-gray-300">—</td>;
                          return (
                            <td key={b} className={`px-3 py-2 text-right font-medium ${v >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                              {money(v)}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right text-rose-500">{money(rowTax)}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${rowProfit - rowTax >= 0 ? 'text-emerald-700' : 'text-rose-500'}`}>
                          {money(rowProfit - rowTax)}
                        </td>
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
