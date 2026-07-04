import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAll, useDB, type Row } from '../data/store';
import { exportCSV } from '../lib/export';
import { IconDownload } from '../components/icons';
import { monthRangeUntilYesterday, yesterdayStr } from '../lib/date';

// "Lợi nhuận tổng" (spec #7): mỗi hàng là 1 nghiệp vụ (tên đơn quảng cáo),
// hiển thị lợi nhuận của ngày cuối khoảng và lợi nhuận cả kỳ (from → to).
// Mặc định: từ mùng 1 → hôm qua (đồng nhất toàn app — dữ liệu nhập cho hôm qua).
const COLLECTIONS = ['importAI', 'importAdv', 'importMedia', 'importYiyi'];
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

interface BizRow { biz: string; today: number; month: number }

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

  const rows = useMemo<BizRow[]>(() => {
    const src = COLLECTIONS.flatMap((c) => getAll(c));
    const map = new Map<string, { today: number; month: number }>();
    for (const r of src) {
      const biz = bizNameOf(r);
      if (!biz) continue;
      const date = String(r.date || '');
      if (from && date < from) continue;
      if (to && date > to) continue;
      const profit = (Number(r.revenue) || 0) - (Number(r.cost) || 0);
      const g = map.get(biz) || { today: 0, month: 0 };
      g.month += profit;
      if (date === to) g.today += profit; // "hôm nay" = ngày cuối khoảng
      map.set(biz, g);
    }
    return Array.from(map.entries())
      .map(([biz, g]) => ({ biz, today: g.today, month: g.month }))
      .sort((a, b) => b.month - a.month);
  }, [from, to]);

  const totals = rows.reduce((s, r) => ({ today: s.today + r.today, month: s.month + r.month }), { today: 0, month: 0 });

  const HEADERS = [t('col.stt'), t('report.business'), t('report.profitToday'), t('report.profitMonth')];

  const doExport = () => {
    const data = rows.map((r, i) => [i + 1, r.biz, r.today, r.month]);
    exportCSV('total_profit', HEADERS, data);
  };

  const sel = "h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-200";

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs font-semibold tracking-widest text-cyan-500">{t('report.eyebrow')}</div>
        <h1 className="text-xl font-bold text-gray-800">{t('menu.g4a')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('col.date')}: <span className="font-medium text-gray-700">{from} ~ {to}</span></p>
      </div>

      {/* Toolbar */}
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

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
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
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">Σ {t('report.grandTotal')} · {rows.length}</td>
                    <td className="px-3 py-2 text-right">{money(totals.today)}</td>
                    <td className="px-3 py-2 text-right text-cyan-300">{money(totals.month)}</td>
                  </tr>
                  {rows.map((r, i) => (
                    <tr key={r.biz} className="border-b border-gray-50 hover:bg-cyan-50/30">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{r.biz}</td>
                      <td className={`px-3 py-2 text-right font-medium ${r.today >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{money(r.today)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${r.month >= 0 ? 'text-emerald-700' : 'text-rose-500'}`}>{money(r.month)}</td>
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
