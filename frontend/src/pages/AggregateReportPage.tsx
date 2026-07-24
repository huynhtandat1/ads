import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDB, effectiveValue, setRate, getAll, refName, type Row } from '../data/store';
import { exportCSV } from '../lib/export';
import { RateEditor } from '../components/RateEditor';
import { DateRangePicker } from '../components/DateRangePicker';
import { IconSearch, IconDownload } from '../components/icons';
import { monthRangeUntilYesterday, ymd } from '../lib/date';
import { perfOf } from '../lib/analytics';
import { round3 } from '../lib/format';
import { sortByGroupedLabel } from '../lib/optionSort';
import { useAuth } from '../auth/AuthContext';

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
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface GroupRow {
  dim: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  tax: number;
  // Thuế THÔ (chưa làm tròn) của nghiệp vụ — để dòng Σ总计 cộng thô rồi làm tròn 1 lần,
  // đồng bộ với Dashboard/g4a (tránh Σround ≠ round(Σ), lệch 1 xu khi nhiều nghiệp vụ).
  rawTax: number;
  afterTax: number;
  // §1: lợi nhuận mỗi ngày của nghiệp vụ, sort ngày tăng dần.
  daily: { date: string; profit: number }[];
  // §3a: Σ doanh thu của từng nhà QC trong nghiệp vụ, sort A→Z theo tên.
  advertisers: { id: number; name: string; total: number }[];
  // §3b: Σ thực trả của từng media trong nghiệp vụ, sort A→Z theo tên.
  media: { id: number; name: string; total: number }[];
  // Phần doanh thu/chi phí đã tính vào tổng nhưng chưa gán được cho NQC/media cụ thể
  // (dòng thiếu id) → hiện thành 1 dòng "chưa phân loại" để breakdown Σ = cột tổng.
  hiddenAdvRevenue: number;
  hiddenMediaCost: number;
}

export function AggregateReportPage({ spec }: { spec: AggregateSpec }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  // Số hook phải CỐ ĐỊNH giữa các lần render (spec.collections dài ngắn khác nhau
  // giữa g4a/g4b) → subscribe cả DB bằng 1 hook thay vì useCollection trong vòng lặp.
  // Giữ giá trị trả về làm dep của memo: trước đây memo chỉ phụ thuộc bộ lọc nên
  // sửa điểm thuế/nhập liệu mới không cập nhật bảng cho tới khi bấm truy vấn lại.
  const dbAll = useDB(); // gồm cả spec.collections lẫn 'rates' (điểm thuế theo hiệu lực ngày)
  const todayStr = ymd(new Date());
  const [defaultFrom, defaultTo] = monthRangeUntilYesterday(0);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [allDates, setAllDates] = useState(false);
  const [fAdv, setFAdv] = useState('');
  const [q, setQ] = useState('');
  const [queried, setQueried] = useState(true); // tự truy vấn khung thời gian mặc định khi vào trang
  const [params, setParams] = useState({ from: defaultFrom, to: defaultTo, allDates: false, fAdv: '', q: '' });
  const [expanded, setExpanded] = useState<string | null>(null); // dim đang mở panel §1+§3
  // Sort bấm tiêu đề: null = giữ mặc định lợi nhuận giảm dần; click cột để đổi (tên A→Z, số giảm dần trước).
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const groups = useMemo<GroupRow[]>(() => {
    if (!queried) return [];
    const db = dbAll;
    // Gắn __src để phân biệt importAdv vs importMedia → §3a/§3b trích đúng nguồn.
    const src: (Row & { __src: string })[] = spec.collections.flatMap(
      (c) => (db[c] || []).map((r) => ({ ...r, __src: c })),
    );
    const lc = params.q.trim().toLowerCase();
    const map = new Map<string, {
      revenue: number; cost: number;
      daily: Map<string, number>;          // §1 — ngày → Σ profit
      adv: Map<number, number>;            // §3a — advertiserId → Σ receivable
      med: Map<number, number>;            // §3b — mediaId → Σ actual
    }>();
    const acc = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) || 0) + v);
    for (const r of src) {
      if (!params.allDates && params.from && r.date < params.from) continue;
      if (!params.allDates && params.to && r.date > params.to) continue;
      if (params.fAdv && String(r.advertiserId) !== params.fAdv) continue;
      const dim = spec.dim(r);
      if (!dim) continue;
      // Bỏ dòng thiếu ngày: ngược lại effectiveValue sẽ rơi về params.to → thuế lệch
      // cho cả cụm, che giấu lỗi dữ liệu khỏi người dùng.
      const date = String(r.date || '');
      if (!date) continue;
      if (lc && !dim.toLowerCase().includes(lc)) continue;
      const g = map.get(dim) || { revenue: 0, cost: 0, daily: new Map(), adv: new Map(), med: new Map() };
      // perfOf: dòng importMedia chỉ đóng góp phần CHI — doanh thu của cùng link
      // đã nằm trong importAdv, cộng cả hai sẽ đếm đôi doanh thu.
      const { revenue: rev, cost } = perfOf(r.__src, r);
      g.revenue += rev;
      g.cost += cost;
      acc(g.daily, r.date, rev - cost);
      // Doanh thu NQC = MỌI nguồn không phải media (importAdv + importAI), khớp với perfOf
      // dùng cho cột 收入. Trước đây chỉ cộng importAdv nên bỏ sót doanh thu nhập qua AI
      // → breakdown 广告主收入 thấp hơn cột 收入. Dùng `rev` (= revenue) để Σ khớp tuyệt đối.
      if (r.__src !== 'importMedia' && r.advertiserId != null) acc(g.adv, Number(r.advertiserId), rev);
      if (r.__src === 'importMedia' && r.mediaId != null) acc(g.med, Number(r.mediaId), Number(r.actual ?? cost));
      map.set(dim, g);
    }
    return Array.from(map.entries()).map(([dim, g]) => {
      const profit = g.revenue - g.cost;
      // Thuế = Σ (lợi nhuận ngày × suất hiệu lực ngày đó) để THÔ, làm tròn 3 số lẻ MỘT lần
      // (hiển thị money() còn 2) — cùng phép tính với g4a nên hai màn khớp, đúng khi suất
      // đổi giữa kỳ, không lệch kiểu Σround(ngày) ≠ round(Σ).
      const rawTax = Array.from(g.daily.entries()).reduce(
        (s, [date, p]) => s + (p * effectiveValue('tax', 0, 'point', isDate(date) ? date : todayStr, TAX_PCT)) / 100,
        0,
      );
      const tax = round3(rawTax);
      const idName = (m: Map<number, number>, collection: string) =>
        Array.from(m.entries())
          .map(([id, total]) => ({ id, name: refName(collection, id) || `#${id}`, total }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
      const advertisers = idName(g.adv, 'advertisers');
      const media = idName(g.med, 'media');
      // Phần còn lại chưa gán được cho NQC/media cụ thể (dòng thiếu id) → hiện thành 1 dòng
      // "chưa phân loại" để Σ breakdown LUÔN = cột tổng (收入 / 成本), không bao giờ lệch.
      const hiddenAdvRevenue = round3(g.revenue - advertisers.reduce((s, a) => s + a.total, 0));
      const hiddenMediaCost = round3(g.cost - media.reduce((s, m) => s + m.total, 0));
      const afterTax = profit - tax;
      // Tỷ suất = LỢI NHUẬN SAU THUẾ / doanh thu (spec khách chốt 07-2026). Trang nào không
      // có thuế (withTax=false) thì afterTax = profit nên rớt về lợi nhuận/doanh thu như cũ.
      const marginBase = spec.withTax ? afterTax : profit;
      return {
        dim, revenue: g.revenue, cost: g.cost, profit,
        margin: g.revenue ? +((marginBase / g.revenue) * 100).toFixed(1) : 0,
        tax, rawTax, afterTax,
        daily: Array.from(g.daily.entries()).map(([date, p]) => ({ date, profit: p })).sort((a, b) => a.date.localeCompare(b.date)),
        advertisers,
        media,
        hiddenAdvRevenue,
        hiddenMediaCost,
      };
    }).sort((a, b) => b.profit - a.profit);
  }, [queried, params, spec, todayStr, dbAll]);

  // Áp sort do người dùng chọn (nếu có) lên kết quả đã tính; mặc định giữ nguyên thứ tự
  // lợi nhuận giảm dần từ `groups`. Tổng/đếm không phụ thuộc thứ tự nên vẫn dùng `groups`.
  const displayGroups = useMemo(() => {
    if (!sort) return groups;
    const arr = [...groups];
    const num = (g: GroupRow) => Number((g as unknown as Record<string, unknown>)[sort.key]) || 0;
    arr.sort((a, b) => sort.key === 'dim'
      ? String(a.dim).localeCompare(String(b.dim), undefined, { sensitivity: 'base' }) * sort.dir
      : (num(a) - num(b)) * sort.dir);
    return arr;
  }, [groups, sort]);

  // Thuế/sau thuế của dòng Σ总计: cộng THÔ tất cả nghiệp vụ rồi làm tròn 1 lần (đồng bộ
  // Dashboard/g4a), không cộng số đã làm tròn của từng nghiệp vụ.
  const rawTotals = groups.reduce((s, g) => ({
    revenue: s.revenue + g.revenue, cost: s.cost + g.cost, profit: s.profit + g.profit, rawTax: s.rawTax + g.rawTax,
  }), { revenue: 0, cost: 0, profit: 0, rawTax: 0 });
  const totals = {
    ...rawTotals,
    tax: round3(rawTotals.rawTax),
    afterTax: round3(rawTotals.profit - rawTotals.rawTax),
  };

  const runQuery = () => { setParams({ from, to, allDates, fAdv, q }); setQueried(true); };
  useEffect(runQuery, [from, to, allDates, fAdv, q]);

  const HEADERS = [t('col.stt'), t(spec.dimLabelKey), t('col.revenue'), t('col.cost'), t('col.profit'),
    ...(spec.withTax ? [t('col.tax'), t('col.afterTax')] : []), t('col.margin')];
  // Khóa sort song song với HEADERS ('' = cột STT không sort). Cột tên mặc định A→Z, cột số giảm dần.
  const SORT_KEYS = ['', 'dim', 'revenue', 'cost', 'profit',
    ...(spec.withTax ? ['tax', 'afterTax'] : []), 'margin'];
  const clickSort = (key: string) => setSort((s) =>
    s?.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: key === 'dim' ? 1 : -1 });

  const doExport = () => {
    const rows = displayGroups.map((g, i) => [i + 1, g.dim, g.revenue, g.cost, g.profit, ...(spec.withTax ? [g.tax, g.afterTax] : []), `${g.margin}%`]);
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
            <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} disabled={allDates} />
          </div>
          {spec.withTax && (
            <div className="flex items-end gap-1.5">
              <label className="block text-xs text-gray-500 mb-1">{t('col.tax')}:</label>
              <RateEditor value={effectiveValue('tax', 0, 'point', todayStr, TAX_PCT)} workingDate={todayStr} suffix="%"
                disabled={!can(spec.screen, 'edit')}
                onSet={(v, eff) => { void setRate('tax', 0, 'point', v, eff, spec.screen); }} />
            </div>
          )}
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-end gap-2 justify-end">
          <button
            type="button"
            aria-pressed={allDates}
            onClick={() => setAllDates((value) => !value)}
            className={`h-9 px-3 rounded-lg border text-sm ${
              allDates ? 'border-cyan-500 bg-cyan-500 text-white' : 'border-gray-200 bg-white text-gray-600'
            }`}
          >
            {t('report.allDates')}
          </button>
          {spec.screen === 'g4b' && (
            <select value={fAdv} onChange={(e) => setFAdv(e.target.value)} className={sel}>
              <option value="">{t('col.advertiser')}</option>
              {sortByGroupedLabel(getAll('advertisers'), (a) => a.name).map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
            </select>
          )}
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
              {!queried ? (
                <tr><td colSpan={HEADERS.length} className="px-3 py-16 text-center text-gray-400">{t('report.queryHint')}</td></tr>
              ) : groups.length === 0 ? (
                <tr><td colSpan={HEADERS.length} className="px-3 py-16 text-center text-gray-400">{t('common.noData')}</td></tr>
              ) : (
                <>
                  <tr className="bg-brand-dark2 text-white font-semibold">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">Σ {t('report.grandTotal')} · {groups.length}</td>
                    <td className="px-3 py-2 text-right text-red-300">{money(totals.revenue)}</td>
                    <td className="px-3 py-2 text-right text-emerald-300">{money(totals.cost)}</td>
                    <td className="px-3 py-2 text-right">{money(totals.profit)}</td>
                    {spec.withTax && <td className="px-3 py-2 text-right text-emerald-300">{money(totals.tax)}</td>}
                    {spec.withTax && <td className="px-3 py-2 text-right text-red-300">{money(totals.afterTax)}</td>}
                    <td className="px-3 py-2 text-right">—</td>
                  </tr>
                  {displayGroups.map((g, i) => (
                    <Fragment key={i}>
                      <tr
                        onClick={() => setExpanded(expanded === g.dim ? null : g.dim)}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${expanded === g.dim ? 'bg-cyan-50/60' : 'hover:bg-cyan-50/30'}`}
                      >
                        <td className="px-3 py-2 whitespace-nowrap text-gray-400">
                          <span className="inline-block w-3 mr-1 text-cyan-600">{expanded === g.dim ? '▾' : '▸'}</span>
                          {i + 1}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{g.dim}</td>
                        <td className="px-3 py-2 text-right text-red-600">{money(g.revenue)}</td>
                        <td className="px-3 py-2 text-right text-emerald-600">{money(g.cost)}</td>
                        <td className="px-3 py-2 text-right font-medium text-black">{money(g.profit)}</td>
                        {spec.withTax && <td className="px-3 py-2 text-right text-emerald-600">{money(g.tax)}</td>}
                        {spec.withTax && <td className="px-3 py-2 text-right font-semibold text-red-600">{money(g.afterTax)}</td>}
                        <td className="px-3 py-2 text-right text-black">{g.margin}%</td>
                      </tr>
                      {expanded === g.dim && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={HEADERS.length} className="px-4 py-4">
                            {/* Lưới 3 cột: §1 (ngày) | §3a (NQC) | §3b (media) */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              {/* §1 Lợi nhuận theo ngày */}
                              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200">
                                  {t('report.dailyProfit')}
                                </div>
                                <table className="w-full text-sm [&_th]:text-center [&_td]:text-center">
                                  <tbody>
                                    {g.daily.length === 0 ? (
                                      <tr><td colSpan={2} className="px-3 py-6 text-center text-gray-400">—</td></tr>
                                    ) : (
                                      <>
                                        {g.daily.map((d) => (
                                          <tr key={d.date} className="border-b border-gray-50">
                                            <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{d.date}</td>
                                            <td className="px-3 py-1.5 text-right font-medium text-black">{money(d.profit)}</td>
                                          </tr>
                                        ))}
                                        <tr className="bg-brand-dark2 text-white font-semibold">
                                          <td className="px-3 py-1.5">Σ {t('report.grandTotal')}</td>
                                          <td className={`px-3 py-1.5 text-right ${g.profit >= 0 ? 'text-cyan-300' : 'text-rose-300'}`}>{money(g.daily.reduce((s, d) => s + d.profit, 0))}</td>
                                        </tr>
                                      </>
                                    )}
                                  </tbody>
                                </table>
                              </div>

                              {/* §3a Thu từ nhà quảng cáo */}
                              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200">
                                  {t('report.detailRevenue')}
                                </div>
                                <table className="w-full text-sm [&_th]:text-center [&_td]:text-center">
                                  <tbody>
                                    {g.advertisers.length === 0 && !g.hiddenAdvRevenue ? (
                                      <tr><td colSpan={2} className="px-3 py-6 text-center text-gray-400">—</td></tr>
                                    ) : (
                                      <>
                                        {g.advertisers.map((a) => (
                                          <tr key={a.id} className="border-b border-gray-50">
                                            <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{a.name}</td>
                                            <td className="px-3 py-1.5 text-right font-medium text-red-600">{money(a.total)}</td>
                                          </tr>
                                        ))}
                                        {!!g.hiddenAdvRevenue && (
                                          <tr className="border-b border-gray-50 bg-amber-50/60">
                                            <td className="px-3 py-1.5 whitespace-nowrap text-amber-700">{t('report.hiddenAdvRevenue')}</td>
                                            <td className="px-3 py-1.5 text-right font-medium text-red-600">{money(g.hiddenAdvRevenue)}</td>
                                          </tr>
                                        )}
                                        <tr className="bg-brand-dark2 text-white font-semibold">
                                          <td className="px-3 py-1.5">Σ {t('report.grandTotal')}</td>
                                          <td className="px-3 py-1.5 text-right text-red-300">{money(g.advertisers.reduce((s, a) => s + a.total, 0) + g.hiddenAdvRevenue)}</td>
                                        </tr>
                                      </>
                                    )}
                                  </tbody>
                                </table>
                              </div>

                              {/* §3b Chi cho media */}
                              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200">
                                  {t('report.detailCost')}
                                </div>
                                <table className="w-full text-sm [&_th]:text-center [&_td]:text-center">
                                  <tbody>
                                    {g.media.length === 0 && !g.hiddenMediaCost ? (
                                      <tr><td colSpan={2} className="px-3 py-6 text-center text-gray-400">—</td></tr>
                                    ) : (
                                      <>
                                        {g.media.map((m) => (
                                          <tr key={m.id} className="border-b border-gray-50">
                                            <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{m.name}</td>
                                            <td className="px-3 py-1.5 text-right font-medium text-emerald-600">{money(m.total)}</td>
                                          </tr>
                                        ))}
                                        {!!g.hiddenMediaCost && (
                                          <tr className="border-b border-gray-50 bg-amber-50/60">
                                            <td className="px-3 py-1.5 whitespace-nowrap text-amber-700">{t('report.hiddenMediaCost')}</td>
                                            <td className="px-3 py-1.5 text-right font-medium text-emerald-600">{money(g.hiddenMediaCost)}</td>
                                          </tr>
                                        )}
                                        <tr className="bg-brand-dark2 text-white font-semibold">
                                          <td className="px-3 py-1.5">Σ {t('report.grandTotal')}</td>
                                          <td className="px-3 py-1.5 text-right text-emerald-300">{money(g.media.reduce((s, m) => s + m.total, 0) + g.hiddenMediaCost)}</td>
                                        </tr>
                                      </>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
