import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { effectiveValue, getAll, refName, useDB, type Row } from '../data/store';
import { nullableNumber, receivableOf, round3OrNull } from '../lib/billing';
import { exportCSV } from '../lib/export';
import { DateRangePicker } from '../components/DateRangePicker';
import { Pager } from '../components/Pager';
import { IconSearch, IconDownload } from '../components/icons';
import { dayMonth, todayRange } from '../lib/date';
import { sortByGroupedLabel } from '../lib/optionSort';

const COLLECTION = 'importAdv';
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

// Spec §9: cột Trạng thái đọc "từ trạng thái ID hiện tại" (Bật/Tắt trong danh mục),
// không phải trạng thái xác nhận của dòng dữ liệu. ID đã bị xóa → rớt về status dòng.
const adStatusOf = (r: Row): boolean => {
  const ad = getAll('adIds').find((a) => a.id === r.adIdId || a.name === r.objectId);
  return ad ? ad.status !== false : r.status !== false;
};

// Bản ghi đã lưu (g3b) có LỆCH với số hiện hành không? Đơn giá đổi hiệu lực sau khi lưu
// → phải thu lệch → tô sáng dòng nhắc lưu lại ở trang nhập liệu (spec 07-2026: 操作部分高亮).
const isStaleAdv = (r: Row): boolean => {
  const ad = getAll('adIds').find((a) => a.id === r.adIdId || a.name === r.objectId);
  if (!ad) return false; // ID đã xóa khỏi danh mục → không còn nguồn để so
  const price = effectiveValue('adId', ad.id, 'unitPrice', String(r.date || ''), Number(ad.unitPrice) || 0);
  const fresh = round3OrNull(receivableOf(String(r.type), {
    unitPrice: price, traffic: r.traffic ?? r.clicks ?? '', settlement: r.settlement ?? '',
  }));
  return Number(r.unitPrice ?? 0) !== price || nullableNumber(r.receivable) !== fresh;
};

export function AdvReportPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const screen = 'g4c';
  // Subscribe store để bảng tự cập nhật khi dữ liệu đổi từ trang khác (nhập liệu g3a/g3b)
  // — trước đây trang này không subscribe nên phải F5 mới thấy số mới.
  const db = useDB();

  const [defaultFrom, defaultTo] = todayRange();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [allDates, setAllDates] = useState(false);
  const [fAdv, setFAdv] = useState('');
  const [fOrder, setFOrder] = useState('');
  const [fAdId, setFAdId] = useState('');
  const [fType, setFType] = useState('');
  const [fPrice, setFPrice] = useState('');
  const [fStatus, setFStatus] = useState<'all' | 'on' | 'off'>('all');
  const [q, setQ] = useState('');
  // Sort cột ngày: mặc định TĂNG dần (spec docx 07-2026), click header để đảo chiều.
  const [dateDir, setDateDir] = useState<1 | -1>(1);
  const [result, setResult] = useState<Row[] | null>(null); // null = chưa truy vấn
  // Phân trang thống nhất toàn site: mặc định 10, chọn 10/30/50 (spec 07-2026).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const orderIdsMatchingFilter = useMemo(() => {
    if (!fOrder) return null;
    const picked = getAll('adOrders').find((o) => String(o.id) === fOrder);
    const name = norm(picked?.name);
    return new Set(getAll('adOrders').filter((o) => norm(o.name) === name).map((o) => o.id));
  }, [fOrder, db]);

  const filteredRows = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return getAll(COLLECTION).filter((r) => {
      if (!allDates && from && r.date < from) return false;
      if (!allDates && to && r.date > to) return false;
      if (fAdv && String(r.advertiserId) !== fAdv) return false;
      if (orderIdsMatchingFilter && !orderIdsMatchingFilter.has(r.adOrderId as number)) return false;
      if (fAdId && String(r.adIdId) !== fAdId) return false;
      if (fType && r.type !== fType) return false;
      if (fPrice && String(r.unitPrice) !== fPrice) return false;
      if (fStatus === 'on' && !adStatusOf(r)) return false;
      if (fStatus === 'off' && adStatusOf(r)) return false;
      if (lc) {
        // Tìm mờ theo spec: NQC / đơn QC / ID QC / loại / đơn giá (tỷ lệ chia).
        const hay = `${r.objectId} ${refName('advertisers', r.advertiserId)} ${refName('adOrders', r.adOrderId)} ${r.type ?? ''} ${r.unitPrice ?? ''}`.toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    }).sort((a, b) =>
      // Ngày theo dateDir (mặc định tăng dần); cùng ngày thì theo chữ cái đầu NQC → đơn QC → ID QC (spec).
      String(a.date).localeCompare(String(b.date)) * dateDir ||
      norm(refName('advertisers', a.advertiserId)).localeCompare(norm(refName('advertisers', b.advertiserId))) ||
      norm(refName('adOrders', a.adOrderId)).localeCompare(norm(refName('adOrders', b.adOrderId))) ||
      norm(a.objectId).localeCompare(norm(b.objectId)));
  }, [from, to, allDates, fAdv, orderIdsMatchingFilter, fAdId, fType, fPrice, fStatus, q, dateDir, db]);

  const runQuery = () => setResult(filteredRows);

  useEffect(() => { setResult(filteredRows); }, [filteredRows]); // lọc ngay khi đổi điều kiện
  useEffect(() => { setPage(1); }, [from, to, allDates, fAdv, fOrder, fAdId, fType, fPrice, fStatus, q]);

  const rows = result ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = rows.slice((curPage - 1) * pageSize, curPage * pageSize);
  const orderOptions = (() => {
    const seen = new Set<string>();
    return sortByGroupedLabel(getAll('adOrders').filter((o) => {
      if (fAdv && String(o.advertiserId) !== fAdv) return false;
      const key = String(o.name ?? '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }), (o) => o.name);
  })();
  // ID quảng cáo phải khớp CẢ nhà QC (fAdv) lẫn đơn QC (orderIdsMatchingFilter) —
  // chọn đơn QC gom cùng tên giữa nhiều nhà QC nên cần lọc theo tập id đó, không chỉ 1 id.
  const adIdOptions = sortByGroupedLabel(getAll('adIds').filter((a) =>
    (!fAdv || String(a.advertiserId) === fAdv) &&
    (!orderIdsMatchingFilter || orderIdsMatchingFilter.has(a.adOrderId as number)),
  ), (a) => a.name);
  const priceOptions = Array.from(new Set(getAll(COLLECTION).map((r) => Number(r.unitPrice) || 0)))
    .sort((a, b) => a - b);
  const totals = rows.reduce(
    (s, r) => ({ traffic: s.traffic + (Number(r.traffic) || 0), settlement: s.settlement + (Number(r.settlement) || 0), receivable: s.receivable + (Number(r.receivable) || 0) }),
    { traffic: 0, settlement: 0, receivable: 0 },
  );

  const HEADERS = [
    t('col.stt'), t('col.date'), t('col.advertiser'), t('col.adOrder'), t('col.type'), t('col.adId'),
    t('entry.unitShare'), t('entry.traffic'), t('entry.settlement'), t('entry.receivable'), t('common.status'),
  ];

  const doExport = () => {
    const data = rows.map((r, i) => [
      i + 1, r.date, refName('advertisers', r.advertiserId), refName('adOrders', r.adOrderId), r.type, r.objectId,
      r.unitPrice, r.traffic, r.settlement, r.receivable, adStatusOf(r) ? t('entry.online') : t('entry.offline'),
    ]);
    exportCSV('advertiser_report', HEADERS, data);
  };

  const sel = "h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-200";

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <div className="text-xs font-semibold tracking-widest text-cyan-500">{t('report.eyebrow')}</div>
        <h1 className="text-xl font-bold text-gray-800">{t('menu.g4c')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('col.date')}: <span className="font-medium text-gray-700">{allDates ? t('report.allDates') : `${from} ~ ${to}`}</span></p>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        {/* Left: date range */}
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('col.date')}</label>
            <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} disabled={allDates} />
          </div>
        </div>

        <div className="flex-1" />

        {/* Right: filters */}
        <div className="flex flex-wrap items-end gap-2 justify-end">
          {/* Business / All dates toggle */}
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden h-9">
            <button onClick={() => setAllDates(false)} className={`px-3 text-sm ${!allDates ? 'bg-cyan-500 text-white' : 'bg-white text-gray-600'}`}>{t('report.business')}</button>
            <button onClick={() => setAllDates(true)} className={`px-3 text-sm ${allDates ? 'bg-cyan-500 text-white' : 'bg-white text-gray-600'}`}>{t('report.allDates')}</button>
          </div>
          <select value={fAdv} onChange={(e) => { setFAdv(e.target.value); setFOrder(''); setFAdId(''); }} className={sel}>
            <option value="">{t('col.advertiser')}</option>
            {sortByGroupedLabel(getAll('advertisers'), (a) => a.name).map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
          </select>
          {/* Đổi đơn QC → reset ID QC (không còn khớp) để tránh filter chết. */}
          <select value={fOrder} onChange={(e) => { setFOrder(e.target.value); setFAdId(''); }} className={sel}>
            <option value="">{t('col.adOrder')}</option>
            {orderOptions.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>
          <select value={fAdId} onChange={(e) => setFAdId(e.target.value)} className={sel}>
            <option value="">{t('col.adId')}</option>
            {adIdOptions.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
          </select>
          <select value={fType} onChange={(e) => setFType(e.target.value)} className={sel}>
            <option value="">{t('col.type')}</option>
            {sortByGroupedLabel(['CPM', 'CPC', 'CPA', 'CPS'], (x) => x).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={fPrice} onChange={(e) => setFPrice(e.target.value)} className={sel}>
            <option value="">{t('report.unitPriceShort')}</option>
            {priceOptions.map((p) => <option key={p} value={String(p)}>{p}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value as typeof fStatus)} className={sel}>
            <option value="all">{t('common.status')}: {t('common.all')}</option>
            {sortByGroupedLabel([
              { value: 'on', label: t('entry.online') },
              { value: 'off', label: t('entry.offline') },
            ], (o) => o.label).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width={16} height={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.searchPh')}
              className="h-9 pl-8 pr-3 rounded-lg border border-gray-200 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-cyan-200" />
          </div>
          <button onClick={runQuery} className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600">
            <IconSearch width={16} height={16} /> {t('report.query')}
          </button>
          <button onClick={doExport} disabled={!result || rows.length === 0}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50">
            <IconDownload width={16} height={16} /> {t('report.exportExcel')}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full text-sm [&_th]:text-center [&_td]:text-center">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                {HEADERS.map((h, i) => (
                  <th key={i} onClick={i === 1 ? () => setDateDir((d) => (d === 1 ? -1 : 1)) : undefined}
                    className={`px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide whitespace-nowrap ${i >= 6 && i <= 9 ? 'text-right' : ''} ${i === 1 ? 'cursor-pointer select-none hover:text-gray-700' : ''}`}>
                    {h}
                    {i === 1 && (
                      <span className="inline-flex flex-col ml-1 text-[8px] leading-none align-middle">
                        <span className={dateDir === 1 ? 'text-cyan-500' : 'text-gray-300'}>▲</span>
                        <span className={dateDir === -1 ? 'text-cyan-500' : 'text-gray-300'}>▼</span>
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result === null ? (
                <tr><td colSpan={HEADERS.length} className="px-3 py-16 text-center text-gray-400">{t('report.queryHint')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={HEADERS.length} className="px-3 py-16 text-center text-gray-400">{t('common.noData')}</td></tr>
              ) : (
                <>
                  {/* Dòng tổng: ngày + mỗi tổng nằm NGAY TRÊN cột tương ứng, căn giữa (spec docx 07-2026). */}
                  <tr className="bg-brand-dark2 text-white font-semibold">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 whitespace-nowrap">📅 {allDates ? t('report.allDates') : `${dayMonth(from)} ~ ${dayMonth(to)}`}</td>
                    <td className="px-3 py-2" colSpan={5}>Σ {t('report.grandTotal')} · {rows.length} {t('report.records')}</td>
                    <td className="px-3 py-2">{totals.traffic.toLocaleString()}</td>
                    <td className="px-3 py-2">{money(totals.settlement)}</td>
                    <td className="px-3 py-2 text-cyan-300">{money(totals.receivable)}</td>
                    <td className="px-3 py-2" />
                  </tr>
                  {pageRows.map((r, i) => {
                    const stale = isStaleAdv(r);
                    return (
                    <tr key={r.id} title={stale ? t('report.stale') : undefined}
                      className={`border-b border-gray-50 ${stale ? 'bg-amber-50 hover:bg-amber-100/70' : 'hover:bg-cyan-50/30'}`}>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-400">{stale ? '⚠' : (curPage - 1) * pageSize + i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{dayMonth(String(r.date))}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{refName('advertisers', r.advertiserId)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{refName('adOrders', r.adOrderId)}</td>
                      <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">{r.type}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{r.objectId}</td>
                      <td className="px-3 py-2 text-right">{r.unitPrice}</td>
                      <td className="px-3 py-2 text-right">{r.traffic == null ? <span className="text-gray-300">—</span> : Number(r.traffic).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{r.settlement == null ? <span className="text-gray-300">—</span> : money(r.settlement)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-600">
                        {r.receivable == null ? <span className="text-gray-300">—</span> : money(r.receivable)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${adStatusOf(r) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {adStatusOf(r) ? t('entry.online') : t('entry.offline')}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
        {result !== null && rows.length > 0 && (
          <Pager total={rows.length} page={curPage} totalPages={totalPages} pageSize={pageSize}
            onPage={setPage} onPageSize={setPageSize} />
        )}
      </div>
    </div>
  );
}
