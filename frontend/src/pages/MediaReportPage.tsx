import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { effectiveValue, getAll, refName, useDB, type Row } from '../data/store';
import { receivableOf } from '../lib/billing';
import { round3 } from '../lib/format';
import { exportCSV } from '../lib/export';
import { DateRangePicker } from '../components/DateRangePicker';
import { IconSearch, IconDownload } from '../components/icons';
import { dayMonth, todayRange } from '../lib/date';
import { isMediaRecordStale } from '../lib/mediaSync';
import { sortByGroupedLabel } from '../lib/optionSort';

const COLLECTION = 'importMedia';
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

// Tính toán giữ 3 số lẻ; hiển thị money() rút về 2 số lẻ. (Trước đây làm tròn nguyên
// từng dòng khiến "thực trả" 22 > "phải trả" 21,64 khi share 100%.)

// Spec §10: cột Trạng thái đọc "từ trạng thái ID hiện tại" (Bật/Tắt trong danh mục),
// không phải trạng thái xác nhận của dòng dữ liệu. ID đã bị xóa → rớt về status dòng.
const midStatusOf = (r: Row): boolean => {
  const mid = getAll('mediaIds').find((m) => m.id === r.mediaIdId || m.name === r.objectId);
  return mid ? mid.status !== false : r.status !== false;
};

function compute(r: Row) {
  const coefficient = Number(r.coefficient ?? 1) || 1;
  const fallbackBase = receivableOf(r.type, { unitPrice: r.unitPrice, traffic: r.traffic, settlement: r.settlement }) ?? 0;
  const receivable = r.receivable != null ? Number(r.receivable) || 0 : round3(fallbackBase * coefficient);
  const mediaId = getAll('mediaIds').find((m) => m.id === r.mediaIdId);
  const fallbackShareRate = Number(mediaId?.profitShare ?? r.shareRate ?? 0) || 0;
  const shareRate = r.mediaIdId != null
    ? effectiveValue('mediaId', r.mediaIdId, 'profitShare', String(r.date || ''), fallbackShareRate)
    : fallbackShareRate;
  const actual = round3(receivable * (shareRate / 100));
  return { receivable, shareRate, coefficient, actual };
}

export function MediaReportPage() {
  const { t } = useTranslation();
  const screen = 'g4d';
  // Subscribe cả store + đưa vào deps memo: trước đây memo chỉ phụ thuộc bộ lọc nên
  // dữ liệu nhập mới (g3c) không hiện cho tới khi F5/đổi bộ lọc.
  const db = useDB();

  const [defaultFrom, defaultTo] = todayRange();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [allDates, setAllDates] = useState(false);
  const [fMedia, setFMedia] = useState('');
  const [fOrder, setFOrder] = useState('');
  const [fMediaId, setFMediaId] = useState('');
  const [fType, setFType] = useState('');
  const [fPrice, setFPrice] = useState('');
  const [fStatus, setFStatus] = useState<'all' | 'on' | 'off'>('all');
  const [q, setQ] = useState('');
  // Sort cột ngày: mặc định TĂNG dần (spec 07-2026 — mọi trang thống nhất), click header đảo chiều.
  const [dateDir, setDateDir] = useState<1 | -1>(1);
  const [result, setResult] = useState<Row[] | null>(null);

  const orderIdsMatchingFilter = useMemo(() => {
    if (!fOrder) return null;
    const picked = getAll('mediaOrders').find((o) => String(o.id) === fOrder);
    const name = norm(picked?.name);
    return new Set(getAll('mediaOrders').filter((o) => norm(o.name) === name).map((o) => o.id));
  }, [fOrder, db]);

  const filteredRows = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return getAll(COLLECTION).filter((r) => {
      if (!allDates && from && r.date < from) return false;
      if (!allDates && to && r.date > to) return false;
      if (fMedia && String(r.mediaId) !== fMedia) return false;
      if (orderIdsMatchingFilter && !orderIdsMatchingFilter.has(r.mediaOrderId as number)) return false;
      if (fMediaId && String(r.mediaIdId) !== fMediaId) return false;
      if (fType && r.type !== fType) return false;
      if (fPrice && String(r.unitPrice) !== fPrice) return false;
      if (fStatus === 'on' && !midStatusOf(r)) return false;
      if (fStatus === 'off' && midStatusOf(r)) return false;
      if (lc) {
        // Tìm mờ theo spec: media / đơn QC media / media ID / loại / đơn giá / tỷ lệ chia.
        const hay = `${r.objectId} ${refName('media', r.mediaId)} ${refName('mediaOrders', r.mediaOrderId)} ${r.type ?? ''} ${r.unitPrice ?? ''} ${r.shareRate ?? ''}`.toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    }).sort((a, b) =>
      // Ngày theo dateDir (mặc định tăng dần); cùng ngày thì theo chữ cái đầu media → đơn QC media → media ID.
      String(a.date).localeCompare(String(b.date)) * dateDir ||
      norm(refName('media', a.mediaId)).localeCompare(norm(refName('media', b.mediaId))) ||
      norm(refName('mediaOrders', a.mediaOrderId)).localeCompare(norm(refName('mediaOrders', b.mediaOrderId))) ||
      norm(a.objectId).localeCompare(norm(b.objectId)));
  }, [from, to, allDates, fMedia, orderIdsMatchingFilter, fMediaId, fType, fPrice, fStatus, q, dateDir, db]);

  const runQuery = () => setResult(filteredRows);

  useEffect(() => { setResult(filteredRows); }, [filteredRows]);


  const rows = result ?? [];
  const orderOptions = (() => {
    const seen = new Set<string>();
    return sortByGroupedLabel(getAll('mediaOrders').filter((o) => {
      if (fMedia && String(o.mediaId) !== fMedia) return false;
      const key = String(o.name ?? '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }), (o) => o.name);
  })();
  const mediaIdOptions = sortByGroupedLabel(getAll('mediaIds').filter((m) =>
    (!fMedia || String(m.mediaId) === fMedia) && (!orderIdsMatchingFilter || orderIdsMatchingFilter.has(m.mediaOrderId as number)),
  ), (m) => m.name);
  const priceOptions = Array.from(new Set(getAll(COLLECTION).map((r) => Number(r.unitPrice) || 0)))
    .sort((a, b) => a - b);
  const totals = rows.reduce((s, r) => {
    const c = compute(r);
    return {
      traffic: s.traffic + (Number(r.traffic) || 0),
      settlement: s.settlement + (Number(r.settlement) || 0),
      receivable: s.receivable + c.receivable,
      actual: s.actual + c.actual,
    };
  }, { traffic: 0, settlement: 0, receivable: 0, actual: 0 });

  // Nhãn theo spec §Tra cứu dữ liệu media: đây là tiền TRẢ cho media
  // (phải trả / tỷ lệ chia tài khoản / thực trả), không phải "phải thu/thực nhận".
  const HEADERS = [
    t('col.stt'), t('col.date'), t('col.media'), t('col.mediaOrder'), t('col.type'), t('col.mediaId'),
    t('entry.unitShare'), t('entry.traffic'), t('entry.settlement'),
    t('entry.payable'), t('col.accountShare'), t('entry.netPay'), t('common.status'),
  ];

  const doExport = () => {
    const data = rows.map((r, i) => {
      const c = compute(r);
      return [
        i + 1, r.date, refName('media', r.mediaId), refName('mediaOrders', r.mediaOrderId), r.type, r.objectId,
        r.unitPrice, r.traffic, r.settlement, c.receivable, `${c.shareRate}%`, c.actual,
        midStatusOf(r) ? t('entry.online') : t('entry.offline'),
      ];
    });
    exportCSV('media_report', HEADERS, data);
  };

  const sel = "h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-200";

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <div className="text-xs font-semibold tracking-widest text-cyan-500">{t('report.eyebrow')}</div>
        <h1 className="text-xl font-bold text-gray-800">{t('menu.g4d')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('col.date')}: <span className="font-medium text-gray-700">{allDates ? t('report.allDates') : `${from} ~ ${to}`}</span></p>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('col.date')}</label>
            <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} disabled={allDates} />
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex flex-wrap items-end gap-2 justify-end">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden h-9">
            <button onClick={() => setAllDates(false)} className={`px-3 text-sm ${!allDates ? 'bg-cyan-500 text-white' : 'bg-white text-gray-600'}`}>{t('report.business')}</button>
            <button onClick={() => setAllDates(true)} className={`px-3 text-sm ${allDates ? 'bg-cyan-500 text-white' : 'bg-white text-gray-600'}`}>{t('report.allDates')}</button>
          </div>
          <select value={fMedia} onChange={(e) => { setFMedia(e.target.value); setFOrder(''); setFMediaId(''); }} className={sel}>
            <option value="">{t('col.media')}</option>
            {sortByGroupedLabel(getAll('media'), (a) => a.name).map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
          </select>
          {/* Đổi đơn QC media → reset media ID (không còn khớp) để tránh filter chết. */}
          <select value={fOrder} onChange={(e) => { setFOrder(e.target.value); setFMediaId(''); }} className={sel}>
            <option value="">{t('col.mediaOrder')}</option>
            {orderOptions.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>
          <select value={fMediaId} onChange={(e) => setFMediaId(e.target.value)} className={sel}>
            <option value="">{t('col.mediaId')}</option>
            {mediaIdOptions.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
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
                    className={`px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide whitespace-nowrap ${i >= 6 && i <= 11 ? 'text-right' : ''} ${i === 1 ? 'cursor-pointer select-none hover:text-gray-700' : ''}`}>
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
                  {/* Dòng tổng: ngày + mỗi tổng nằm NGAY TRÊN cột tương ứng, căn giữa (đồng bộ với g4c). */}
                  <tr className="bg-brand-dark2 text-white font-semibold">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 whitespace-nowrap">📅 {allDates ? t('report.allDates') : `${dayMonth(from)} ~ ${dayMonth(to)}`}</td>
                    <td className="px-3 py-2" colSpan={5}>Σ {t('report.grandTotal')} · {rows.length} {t('report.records')}</td>
                    <td className="px-3 py-2">{totals.traffic.toLocaleString()}</td>
                    <td className="px-3 py-2">{money(totals.settlement)}</td>
                    <td className="px-3 py-2">{money(totals.receivable)}</td>
                    <td className="px-3 py-2">—</td>
                    <td className="px-3 py-2 text-cyan-300">{money(totals.actual)}</td>
                    <td className="px-3 py-2" />
                  </tr>
                  {rows.map((r, i) => {
                    const c = compute(r);
                    // Bản ghi lệch với số tính lại từ thượng nguồn (NQC/đơn giá/hệ số đổi
                    // sau khi lưu) → tô sáng nhắc lưu lại ở g3c (spec 07-2026: 操作部分高亮).
                    const stale = isMediaRecordStale(r);
                    return (
                      <tr key={r.id} title={stale ? t('report.stale') : undefined}
                        className={`border-b border-gray-50 ${stale ? 'bg-amber-50 hover:bg-amber-100/70' : 'hover:bg-cyan-50/30'}`}>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-400">{stale ? '⚠' : i + 1}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{dayMonth(String(r.date))}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{refName('media', r.mediaId)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{refName('mediaOrders', r.mediaOrderId)}</td>
                        <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">{r.type}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{r.objectId}</td>
                        <td className="px-3 py-2 text-right">{r.unitPrice}</td>
                        <td className="px-3 py-2 text-right">{Number(r.traffic).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{money(r.settlement)}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-700">{money(c.receivable)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{c.shareRate}%</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-600">{money(c.actual)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${midStatusOf(r) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            {midStatusOf(r) ? t('entry.online') : t('entry.offline')}
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
      </div>
    </div>
  );
}
