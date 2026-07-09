import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollection } from '../data/store';
import { round3 } from '../lib/format';
import { exportCSV } from '../lib/export';
import { DateRangePicker } from '../components/DateRangePicker';
import { IconSearch, IconDownload, IconRefresh } from '../components/icons';
import { datesInRange, monthRangeUntilYesterday } from '../lib/date';

const COLLECTION = 'importYiyi';
const CHANNELS = ['yy-02-01', 'yy-02-02', 'yy-02-03', 'yy-02-04'];
const money2 = (v: number) => '¥' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface DayRow {
  date: string; ch: Record<string, number>; traffic: number;
  unitPrice: number; profitUnitPrice: number; payable: number; profit: number; total: number;
}

export function YiyiReportPage() {
  const { t } = useTranslation();
  // Subscribe store để bảng tự tính lại khi nhập liệu ở trang khác (g3d) — trước đây
  // đọc getAll một lần trong memo nên dữ liệu mới không hiện cho tới khi F5.
  const records = useCollection(COLLECTION);
  const [defaultFrom, defaultTo] = monthRangeUntilYesterday(0);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [query, setQuery] = useState<{ from: string; to: string } | null>({ from: defaultFrom, to: defaultTo });

  const data = useMemo<DayRow[]>(() => {
    if (!query) return [];
    return datesInRange(query.from, query.to).map((date) => {
      const recs = records.filter((r) => r.date === date);
      const ch: Record<string, number> = {};
      for (const c of CHANNELS) ch[c] = recs.find((r) => r.objectId === c)?.quantity ?? 0;
      const traffic = CHANNELS.reduce((s, c) => s + ch[c], 0);
      const unitPrice = recs[0]?.unitPrice ?? 0;
      const profitUnitPrice = recs[0]?.profitUnitPrice ?? 0;
      // Cộng theo TỪNG KÊNH đã làm tròn 3 số lẻ — khớp với số đã lưu ở g3d và phần chi
      // Yiyi trong bảng lợi nhuận (hiển thị money2() rút về 2 số lẻ).
      const payable = CHANNELS.reduce((s, c2) => s + round3(((ch[c2] || 0) * unitPrice) / 1000), 0);
      const profit = CHANNELS.reduce((s, c2) => s + round3(((ch[c2] || 0) * profitUnitPrice) / 1000), 0);
      return { date, ch, traffic, unitPrice, profitUnitPrice, payable, profit, total: payable + profit };
    });
  }, [query, records]);

  const totals = data.reduce(
    (s, r) => ({ traffic: s.traffic + r.traffic, payable: s.payable + r.payable, profit: s.profit + r.profit, total: s.total + r.total }),
    { traffic: 0, payable: 0, profit: 0, total: 0 },
  );
  const daysInRange = data.length;

  const HEADERS = [
    t('col.stt'), t('col.date'), t('report.traffic'), t('report.unitPriceShort'), t('entry.payable'),
    'YY-02-01', 'YY-02-02', 'YY-02-03', 'YY-02-04',
    t('report.profitUnitPrice'), t('col.profit'), t('report.grandTotal'),
  ];

  const doExport = () => {
    const rows = data.map((r, i) => [
      i + 1, r.date, r.traffic, r.unitPrice, r.payable.toFixed(2),
      r.ch['yy-02-01'], r.ch['yy-02-02'], r.ch['yy-02-03'], r.ch['yy-02-04'],
      r.profitUnitPrice, r.profit.toFixed(2), r.total.toFixed(2),
    ]);
    exportCSV(`yiyi_report_${query?.from}_${query?.to}`, HEADERS, rows);
  };

  const cards = [
    { label: t('report.traffic'), value: totals.traffic.toLocaleString(), accent: 'text-cyan-600', big: false },
    { label: t('entry.payable'), value: money2(totals.payable), accent: 'text-orange-600', big: false },
    { label: t('col.profit'), value: money2(totals.profit), accent: 'text-emerald-600', big: false },
    { label: t('report.grandTotal'), value: money2(totals.total), accent: 'text-white', big: true },
  ];

  return (
    <div>
      {/* Header + toolbar */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <div className="text-xs font-semibold tracking-widest text-cyan-500">{t('report.eyebrow')}</div>
          <h1 className="text-xl font-bold text-gray-800">{t('menu.g4e')}</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">{t('report.yiyiDesc')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          <button onClick={() => setQuery({ from, to })}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600">
            <IconSearch width={16} height={16} /> {t('report.query')}
          </button>
          <button onClick={doExport} disabled={!query}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <IconDownload width={16} height={16} /> {t('report.exportCSV')}
          </button>
          <button onClick={() => setQuery(null)} title={t('common.all')}
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
            <IconRefresh width={16} height={16} />
          </button>
        </div>
      </div>

      {/* 4 summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
        {cards.map((c, i) => (
          <div key={i} className={`rounded-xl p-5 border shadow-sm ${c.big ? 'border-cyan-500 bg-gradient-to-br from-cyan-500 to-sky-600 text-white' : 'border-gray-200 bg-white'}`}>
            <div className={`text-sm flex items-center gap-1.5 ${c.big ? 'text-cyan-50' : 'text-gray-500'}`}>
              {c.label}
            </div>
            <div className={`text-2xl font-bold mt-1 ${c.accent}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Stat line */}
      <div className="text-xs text-gray-500 mb-4">
        {daysInRange} {t('report.daysUnit')} · 0 {t('report.invalidRows')} · <span className="text-emerald-600 font-medium">{t('report.validData')}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-360px)]">
          <table className="w-full text-sm [&_th]:text-center [&_td]:text-center">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-gray-500 bg-cyan-50 border-b border-cyan-100">
                {HEADERS.map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide whitespace-nowrap ${i > 1 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!query ? (
                <tr><td colSpan={HEADERS.length} className="px-3 py-16 text-center text-gray-400">{t('report.queryHint')}</td></tr>
              ) : (
                <>
                  <tr className="bg-brand-dark2 text-white font-semibold">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">Σ {t('report.grandTotal')}</td>
                    <td className="px-3 py-2 text-right">{totals.traffic.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right">{money2(totals.payable)}</td>
                    <td className="px-3 py-2 text-right" colSpan={4}>—</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right">{money2(totals.profit)}</td>
                    <td className="px-3 py-2 text-right text-cyan-300">{money2(totals.total)}</td>
                  </tr>
                  {data.map((r, i) => (
                    <tr key={r.date} className="border-b border-gray-50 hover:bg-cyan-50/30">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{r.date}</td>
                      <td className="px-3 py-2 text-right font-medium">{r.traffic.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{r.unitPrice}</td>
                      <td className="px-3 py-2 text-right text-orange-600">{money2(r.payable)}</td>
                      {CHANNELS.map((c) => (
                        <td key={c} className="px-3 py-2 text-right text-gray-500">{r.ch[c] ? r.ch[c].toLocaleString() : '-'}</td>
                      ))}
                      <td className="px-3 py-2 text-right text-gray-500">{r.profitUnitPrice}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">{money2(r.profit)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-cyan-700">{money2(r.total)}</td>
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
