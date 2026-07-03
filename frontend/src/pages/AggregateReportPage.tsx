import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { snapshot, useDB, effectiveValue, setRate, type Row } from '../data/store';
import { exportCSV } from '../lib/export';
import { RateEditor } from '../components/RateEditor';
import { LatestDataHint } from '../components/LatestDataHint';
import { IconSearch, IconDownload } from '../components/icons';
import { monthRangeUntilYesterday, ymd } from '../lib/date';

export interface AggregateSpec {
  screen: string;
  titleKey: string;
  collections: string[];
  dim: (row: Row) => string;
  dimLabelKey: string;
  withTax?: boolean;
}

const TAX_PCT = 6; // Điểm thuế mặc định 6% (có thể sửa theo hiệu lực ngày)
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

interface GroupRow { dim: string; revenue: number; cost: number; profit: number; margin: number; tax: number; afterTax: number }

export function AggregateReportPage({ spec }: { spec: AggregateSpec }) {
  const { t } = useTranslation();
  // Số hook phải CỐ ĐỊNH giữa các lần render (spec.collections dài ngắn khác nhau
  // giữa g4a/g4b) → subscribe cả DB bằng 1 hook thay vì useCollection trong vòng lặp.
  useDB(); // gồm cả spec.collections lẫn 'rates' (điểm thuế theo hiệu lực ngày)
  const todayStr = ymd(new Date());

  const [from, setFrom] = useState(monthRangeUntilYesterday(0)[0]);
  const [to, setTo] = useState(monthRangeUntilYesterday(0)[1]);
  const [allDates, setAllDates] = useState(false);
  const [q, setQ] = useState('');
  const [queried, setQueried] = useState(false);
  const [params, setParams] = useState({ from: monthRangeUntilYesterday(0)[0], to: monthRangeUntilYesterday(0)[1], allDates: false, q: '' });

  const groups = useMemo<GroupRow[]>(() => {
    if (!queried) return [];
    const db = snapshot();
    const src = spec.collections.flatMap((c) => db[c] || []);
    const lc = params.q.trim().toLowerCase();
    const map = new Map<string, { revenue: number; cost: number }>();
    for (const r of src) {
      if (!params.allDates && params.from && r.date < params.from) continue;
      if (!params.allDates && params.to && r.date > params.to) continue;
      const dim = spec.dim(r);
      if (!dim) continue;
      if (lc && !dim.toLowerCase().includes(lc)) continue;
      const g = map.get(dim) || { revenue: 0, cost: 0 };
      g.revenue += Number(r.revenue) || 0;
      g.cost += Number(r.cost) || 0;
      map.set(dim, g);
    }
    return Array.from(map.entries()).map(([dim, g]) => {
      const profit = g.revenue - g.cost;
      // điểm thuế có hiệu lực theo ngày (nếu nhóm theo ngày), else theo hôm nay
      const taxPct = effectiveValue('tax', 0, 'point', isDate(dim) ? dim : params.to || todayStr, TAX_PCT);
      const tax = Math.round((profit * taxPct) / 100);
      return { dim, revenue: g.revenue, cost: g.cost, profit, margin: g.revenue ? +((profit / g.revenue) * 100).toFixed(1) : 0, tax, afterTax: profit - tax };
    }).sort((a, b) => b.profit - a.profit);
  }, [queried, params, spec, todayStr]);

  const totals = groups.reduce((s, g) => ({
    revenue: s.revenue + g.revenue, cost: s.cost + g.cost, profit: s.profit + g.profit, tax: s.tax + g.tax, afterTax: s.afterTax + g.afterTax,
  }), { revenue: 0, cost: 0, profit: 0, tax: 0, afterTax: 0 });

  const runQuery = () => { setParams({ from, to, allDates, q }); setQueried(true); };
  const pickThisMonth = () => { const [f, tt] = monthRangeUntilYesterday(0); setFrom(f); setTo(tt); setAllDates(false); };
  const pickLastMonth = () => { const [f, tt] = monthRangeUntilYesterday(-1); setFrom(f); setTo(tt); setAllDates(false); };

  const HEADERS = [t(spec.dimLabelKey), t('col.revenue'), t('col.cost'), t('col.profit'),
    ...(spec.withTax ? [t('col.tax'), t('col.afterTax')] : []), t('col.margin')];

  const doExport = () => {
    const rows = groups.map((g) => [g.dim, g.revenue, g.cost, g.profit, ...(spec.withTax ? [g.tax, g.afterTax] : []), `${g.margin}%`]);
    exportCSV(spec.screen, HEADERS, rows);
  };

  const sel = "h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-200";

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs font-semibold tracking-widest text-cyan-500">{t('report.eyebrow')}</div>
        <h1 className="text-xl font-bold text-gray-800">{t(spec.titleKey)}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('col.date')}: <span className="font-medium text-gray-700">{allDates ? t('report.allDates') : `${from} ~ ${to}`}</span></p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('col.date')}</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={from} disabled={allDates} onChange={(e) => setFrom(e.target.value)} className={`${sel} disabled:bg-gray-50`} />
              <span className="text-gray-400">—</span>
              <input type="date" value={to} disabled={allDates} onChange={(e) => setTo(e.target.value)} className={`${sel} disabled:bg-gray-50`} />
            </div>
          </div>
          <button onClick={pickThisMonth} className="h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">{t('report.thisMonth')}</button>
          <button onClick={pickLastMonth} className="h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">{t('report.lastMonth')}</button>
          <LatestDataHint collections={spec.collections} current={to}
            onPick={(d) => { setFrom(`${d.slice(0, 7)}-01`); setTo(d); setAllDates(false); }} />
          {spec.withTax && (
            <div className="flex items-end gap-1.5">
              <label className="block text-xs text-gray-500 mb-1">{t('col.tax')}:</label>
              <RateEditor value={effectiveValue('tax', 0, 'point', todayStr, TAX_PCT)} workingDate={todayStr} suffix="%"
                onSet={(v, eff) => setRate('tax', 0, 'point', v, eff)} />
            </div>
          )}
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-end gap-2 justify-end">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden h-9">
            <button onClick={() => setAllDates(false)} className={`px-3 text-sm ${!allDates ? 'bg-cyan-500 text-white' : 'bg-white text-gray-600'}`}>{t('report.business')}</button>
            <button onClick={() => setAllDates(true)} className={`px-3 text-sm ${allDates ? 'bg-cyan-500 text-white' : 'bg-white text-gray-600'}`}>{t('report.allDates')}</button>
          </div>
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width={16} height={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.searchPh')}
              className="h-9 pl-8 pr-3 rounded-lg border border-gray-200 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-cyan-200" />
          </div>
          <button onClick={runQuery} className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600">
            <IconSearch width={16} height={16} /> {t('report.query')}
          </button>
          <button onClick={doExport} disabled={!queried || groups.length === 0}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50">
            <IconDownload width={16} height={16} /> {t('report.exportExcel')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                {HEADERS.map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide whitespace-nowrap ${i > 0 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!queried ? (
                <tr><td colSpan={HEADERS.length} className="px-3 py-16 text-center text-gray-400">{t('report.queryHint')}</td></tr>
              ) : groups.length === 0 ? (
                <tr><td colSpan={HEADERS.length} className="px-3 py-16 text-center text-gray-400">{t('common.noData')}</td></tr>
              ) : (
                <>
                  <tr className="bg-brand-dark2 text-white font-semibold">
                    <td className="px-3 py-2">Σ {t('report.grandTotal')} · {groups.length}</td>
                    <td className="px-3 py-2 text-right">{money(totals.revenue)}</td>
                    <td className="px-3 py-2 text-right">{money(totals.cost)}</td>
                    <td className="px-3 py-2 text-right">{money(totals.profit)}</td>
                    {spec.withTax && <td className="px-3 py-2 text-right">{money(totals.tax)}</td>}
                    {spec.withTax && <td className="px-3 py-2 text-right text-cyan-300">{money(totals.afterTax)}</td>}
                    <td className="px-3 py-2 text-right">—</td>
                  </tr>
                  {groups.map((g, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-cyan-50/30">
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{g.dim}</td>
                      <td className="px-3 py-2 text-right">{money(g.revenue)}</td>
                      <td className="px-3 py-2 text-right">{money(g.cost)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${g.profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{money(g.profit)}</td>
                      {spec.withTax && <td className="px-3 py-2 text-right text-rose-500">{money(g.tax)}</td>}
                      {spec.withTax && <td className="px-3 py-2 text-right font-semibold text-emerald-700">{money(g.afterTax)}</td>}
                      <td className="px-3 py-2 text-right text-gray-600">{g.margin}%</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
