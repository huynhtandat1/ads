import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { effectiveValue, getAll, useDB, type Row } from '../data/store';
import { perfOf } from '../lib/analytics';
import { round3 } from '../lib/format';
import { exportCSV } from '../lib/export';
import { DateRangePicker } from '../components/DateRangePicker';
import { IconDownload } from '../components/icons';
import { monthRangeUntilYesterday, yesterdayStr, ymd } from '../lib/date';

// "Lợi nhuận tổng" (spec g4a): 2 bảng theo đặc tả PDF §Bảng tổng lợi nhuận
//   1. Lợi nhuận mỗi NGÀY theo từng nghiệp vụ
//   2. Tổng lợi nhuận THÁNG theo từng nghiệp vụ (đã có sẵn, nay trừ thuế)
// Thuế 6% theo versioning `tax:0:point` — đồng bộ với g4b (AggregateReportPage).
const TAX_PCT = 6;
const COLLECTIONS = ['importAI', 'importAdv', 'importMedia'];
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface DailyCell { biz: string; date: string; profit: number; tax: number }
// raw giữ giá trị thô trước khi làm tròn để cộng Σ chính xác (spec không lệch vài xu).
interface BizRow { biz: string; today: number; month: number; monthTax: number; rawToday: number; rawMonth: number; rawMonthTax: number }

const bizNameOf = (r: Row): string => {
  // Nghiệp vụ theo đơn QC của ID QUẢNG CÁO (khóa chung thu↔chi); hồ sơ Media ID có thể
  // ghi lệch đơn QC so với adId, dùng r.adOrderId sẽ tách chi media khỏi doanh thu.
  const adId = r.adIdId != null ? getAll('adIds').find((a) => a.id === r.adIdId) : undefined;
  const orderId = adId?.adOrderId ?? r.adOrderId;
  if (orderId == null) return '';
  const order = getAll('adOrders').find((o) => o.id === orderId);
  return order ? String(order.name) : '';
};

export function TotalProfitPage() {
  const { t } = useTranslation();
  // Đưa db vào deps memo để bảng tự tính lại khi dữ liệu/thuế đổi (kể cả từ trang khác).
  const db = useDB();
  const [defaultFrom, defaultTo] = monthRangeUntilYesterday(0);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  // Sort bấm tiêu đề bảng 业务: null = giữ mặc định 本月利润 giảm dần; click cột để đổi (tên A→Z, số giảm dần trước).
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);


  const todayStr = ymd(new Date());

  // Bảng 1 — Lợi nhuận MỖI NGÀY × NGHIỆP VỤ, sort ngày tăng dần.
  const daily = useMemo<DailyCell[]>(() => {
    // Giữ tên collection để perfOf loại doanh thu trùng của importMedia (chỉ tính chi).
    const src = COLLECTIONS.flatMap((c) => getAll(c).map((r) => ({ c, r })));
    // Gộp lợi nhuận theo (nghiệp vụ, ngày) TRƯỚC, thuế tính MỘT LẦN trên tổng ngày.
    const map = new Map<string, number>();
    for (const { c, r } of src) {
      const biz = bizNameOf(r);
      if (!biz) continue;
      const date = String(r.date || '');
      if (from && date < from) continue;
      if (to && date > to) continue;
      const perf = perfOf(c, r);
      const key = `${biz}|${date}`;
      map.set(key, (map.get(key) || 0) + (perf.revenue - perf.cost));
    }
    return Array.from(map.entries())
      .map(([k, profit]) => {
        const [biz, date] = k.split('|');
        const taxPct = effectiveValue('tax', 0, 'point', date, TAX_PCT);
        // Thuế ngày làm tròn 3 số lẻ (tính toán); money() lo phần hiển thị 2 số lẻ.
        return { biz, date, profit, tax: round3((profit * taxPct) / 100) };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.biz.localeCompare(b.biz));
  }, [from, to, db]);

  // Bảng 2 — Tổng lợi nhuận THÁNG theo nghiệp vụ. Profit đã TRỪ thuế (đồng bộ g4b + spec).
  const { rows, todayDate } = useMemo(() => {
    const src = COLLECTIONS.flatMap((c) => getAll(c).map((r) => ({ c, r })));
    // Gộp lợi nhuận theo (nghiệp vụ, ngày) trước — thuế tính một lần trên tổng ngày
    // (vẫn tôn trọng suất đổi giữa kỳ), khớp tuyệt đối với bảng 1 và g4b.
    const dayMap = new Map<string, number>();
    for (const { c, r } of src) {
      const biz = bizNameOf(r);
      if (!biz) continue;
      const date = String(r.date || '');
      if (!date) continue; // bỏ dòng thiếu ngày: thuế theo effectiveValue sẽ lệch cho cả cụm.
      if (from && date < from) continue;
      if (to && date > to) continue;
      const perf = perfOf(c, r);
      const key = `${biz}|${date}`;
      dayMap.set(key, (dayMap.get(key) || 0) + (perf.revenue - perf.cost));
    }
    // Cột "lợi nhuận ngày X" LUÔN là NGÀY HÔM QUA theo lịch (hôm nay 07 → cột 06,
    // hôm nay 08 → cột 07) — chưa nhập liệu ngày đó thì hiện 0, không trượt về
    // ngày gần nhất có dữ liệu.
    const dayCol = yesterdayStr();
    const map = new Map<string, { today: number; month: number; monthTax: number }>();
    for (const [k, p] of dayMap) {
      const cut = k.lastIndexOf('|');
      const biz = k.slice(0, cut), date = k.slice(cut + 1);
      const taxPct = effectiveValue('tax', 0, 'point', date, TAX_PCT);
      // Cộng thuế thô từng ngày; làm tròn 3 số lẻ khi ra kết quả (hiển thị money() còn 2).
      const tax = (p * taxPct) / 100;
      const g = map.get(biz) || { today: 0, month: 0, monthTax: 0 };
      g.month += p;
      g.monthTax += tax;
      if (date === dayCol) g.today += p - tax;
      map.set(biz, g);
    }
    const out: BizRow[] = Array.from(map.entries())
      .map(([biz, g]) => ({
        biz,
        today: round3(g.today),
        month: round3(g.month - g.monthTax),
        monthTax: round3(g.monthTax),
        // giữ raw để Σ cộng xong rồi round 1 lần, tránh Σround ≠ round(Σ).
        rawToday: g.today, rawMonth: g.month, rawMonthTax: g.monthTax,
      }))
      .sort((a, b) => b.month - a.month);
    return { rows: out, todayDate: dayCol };
  }, [from, to, db]);

  // Σ cộng raw (chưa round) rồi round 1 lần — khớp với export CSV và không lệch kiểu Σround ≠ round(Σ).
  const totals = rows.reduce((s, r) => ({
    today: round3(s.todayRaw + r.rawToday),
    month: round3(s.monthRaw + r.rawMonth - r.rawMonthTax),
    monthTax: round3(s.monthTaxRaw + r.rawMonthTax),
    todayRaw: s.todayRaw + r.rawToday,
    monthRaw: s.monthRaw + r.rawMonth,
    monthTaxRaw: s.monthTaxRaw + r.rawMonthTax,
  }), { today: 0, month: 0, monthTax: 0, todayRaw: 0, monthRaw: 0, monthTaxRaw: 0 });

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
    t('report.profitToday', { to: todayDate }),
    t('col.tax'),
    t('report.profitMonth'),
  ];
  // Khóa sort song song HEADERS ('' = cột STT không sort). Cột 业务 mặc định A→Z, cột số giảm dần.
  const SORT_KEYS = ['', 'biz', 'today', 'monthTax', 'month'];
  const clickSort = (key: string) => setSort((s) =>
    s?.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: key === 'biz' ? 1 : -1 });
  // Áp sort người dùng chọn; mặc định giữ thứ tự 本月利润 giảm dần từ `rows`.
  const displayRows = useMemo(() => {
    if (!sort) return rows;
    const arr = [...rows];
    arr.sort((a, b) => sort.key === 'biz'
      ? String(a.biz).localeCompare(String(b.biz), undefined, { sensitivity: 'base' }) * sort.dir
      : ((Number((a as unknown as Record<string, unknown>)[sort.key]) || 0) - (Number((b as unknown as Record<string, unknown>)[sort.key]) || 0)) * sort.dir);
    return arr;
  }, [rows, sort]);

  const doExport = () => {
    const data = displayRows.map((r, i) => [i + 1, r.biz, r.today, r.monthTax, r.month]);
    exportCSV('total_profit', HEADERS, data);
  };

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs font-semibold tracking-widest text-cyan-500">{t('report.eyebrow')}</div>
        <h1 className="text-xl font-bold text-gray-800">{t('menu.g4a')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {t('col.date')}: <span className="font-medium text-gray-700">{from} ~ {to}</span>
          <span className="ml-2 text-gray-400">({t('report.eyebrow')} · {t('col.tax')} {effectiveValue('tax', 0, 'point', todayStr, TAX_PCT)}%)</span>
        </p>
      </div>

      {/* Toolbar (dùng chung cho cả 2 bảng) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('col.date')}</label>
            <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          </div>
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
          <table className="w-full text-sm [&_th]:text-center [&_td]:text-center">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                {HEADERS.map((h, i) => {
                  const key = SORT_KEYS[i];
                  const sortable = !!key;
                  const active = sort?.key === key;
                  return (
                    <th key={i} onClick={sortable ? () => clickSort(key) : undefined}
                      className={`px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide whitespace-nowrap ${i > 1 ? 'text-right' : ''} ${sortable ? 'cursor-pointer select-none hover:text-gray-700' : ''}`}>
                      <span className={`inline-flex items-center gap-1 ${i > 1 ? 'flex-row-reverse' : ''}`}>
                        {h}
                        {sortable && (
                          <span className="inline-flex flex-col text-[8px] leading-none">
                            <span className={active && sort!.dir === 1 ? 'text-cyan-500' : 'text-gray-300'}>▲</span>
                            <span className={active && sort!.dir === -1 ? 'text-cyan-500' : 'text-gray-300'}>▼</span>
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={HEADERS.length} className="px-3 py-16 text-center text-gray-400">{t('common.noData')}</td></tr>
              ) : (
                <>
                  <tr className="bg-brand-dark2 text-white font-semibold">
                    <td colSpan={2} className="px-3 py-2">Σ {t('report.grandTotal')} · {rows.length}</td>
                    <td className="px-3 py-2 text-right text-red-300">{money(totals.today)}</td>
                    <td className="px-3 py-2 text-right text-emerald-300">{money(totals.monthTax)}</td>
                    <td className="px-3 py-2 text-right text-red-300">{money(totals.month)}</td>
                  </tr>
                  {displayRows.map((r, i) => (
                    <tr key={r.biz} className="border-b border-gray-50 hover:bg-cyan-50/30">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{r.biz}</td>
                      <td className="px-3 py-2 text-right font-medium text-red-600">{money(r.today)}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">{money(r.monthTax)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-red-600">{money(r.month)}</td>
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
          <table className="w-full text-sm [&_th]:text-center [&_td]:text-center">
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
                    <td className="px-3 py-2 text-right text-emerald-300">{money(dailyTotal.tax)}</td>
                    <td className="px-3 py-2 text-right text-red-300">
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
                            <td key={b} className="px-3 py-2 text-right font-medium text-black">
                              {money(v)}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right text-emerald-600">{money(rowTax)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-red-600">
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
