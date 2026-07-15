import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { useCollection, getAll, create, update, refName, setRate, type Row } from '../data/store';
import { Pager } from '../components/Pager';
import { RateEditor } from '../components/RateEditor';
import { DateRangePicker } from '../components/DateRangePicker';
import { IconSearch, IconDownload } from '../components/icons';
import { dayMonth, inRange, useDatesInRange, yesterdayRange } from '../lib/date';
import { calcMediaCell, isMediaRecordStale, mediaTypeOf } from '../lib/mediaSync';
import { sortByGroupedLabel } from '../lib/optionSort';

const COLLECTION = 'importMedia';
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Traffic CPS = giá trị đơn hàng (tiền) → luôn 2 chữ số thập phân, KHÔNG ký hiệu ¥.
const money2 = (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

const typeOf = mediaTypeOf;

export function MediaDataEntryPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();
  const screen = 'g3c';
  useCollection(COLLECTION);
  useCollection('importAdv'); // lưu lượng/quyết toán đọc từ đây
  useCollection('rates');     // lịch sử đơn giá/hệ số/tỷ lệ chia TK
  const mediaIdsAll = useCollection('mediaIds');

  const [defaultFrom, defaultTo] = yesterdayRange();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const datesInRange = useDatesInRange(from, to);
  const [fMedia, setFMedia] = useState('');
  const [fOrder, setFOrder] = useState('');
  const [fMediaId, setFMediaId] = useState('');
  const [fType, setFType] = useState('');
  const [fPrice, setFPrice] = useState('');
  const [fStatus, setFStatus] = useState<'all' | 'confirmed' | 'unconfirmed'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  // Sort cột ngày: mặc định TĂNG dần (spec 07-2026 — mọi trang thống nhất), click header đảo chiều.
  const [dateDir, setDateDir] = useState<1 | -1>(1);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const canCreate = can(screen, 'create');
  const canEdit = can(screen, 'edit');

  const load = () => {
    const saved = new Set<string>();
    const records = getAll(COLLECTION);
    const lo = from, hi = to;
    for (const m of getAll('mediaIds')) {
      // Lưu dấu (id × date) đã có record trong khoảng; dùng cho cả filter status và nút "Đã lưu".
      for (const r of records) {
        if (!inRange(String(r.date || ''), lo, hi)) continue;
        if (r.mediaIdId === m.id || r.objectId === m.name) saved.add(`${m.id}|${String(r.date)}`);
      }
    }
    setSavedIds(saved);
  };
  useEffect(load, [from, to]);
  useEffect(() => { setPage(1); }, [from, to, fMedia, fOrder, fMediaId, fType, fPrice, fStatus, q]);

  const mediaOpts = sortByGroupedLabel(getAll('media'), (r) => r.name);
  const orderOpts = useMemo(() => {
    const seen = new Set<string>();
    return sortByGroupedLabel(getAll('mediaOrders').filter((o) => {
      if (fMedia && String(o.mediaId) !== fMedia) return false;
      const key = String(o.name ?? '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }), (o) => o.name);
  }, [fMedia, mediaIdsAll]);
  // fOrder giữ id của 1 đơn đại diện, nhưng dropdown đã gộp theo TÊN → lọc phải khớp MỌI đơn
  // cùng tên (đồng bộ với g3b ở AdvDataEntryPage) tránh sót media-id khi cùng tên đơn.
  const mediaOrderIdsMatchingFilter = useMemo(() => {
    if (!fOrder) return null;
    const picked = getAll('mediaOrders').find((o) => String(o.id) === fOrder);
    const name = norm(picked?.name);
    return new Set(getAll('mediaOrders').filter((o) => norm(o.name) === name).map((o) => o.id));
  }, [fOrder, mediaIdsAll]);
  const mediaIdOpts = useMemo(
    () => sortByGroupedLabel(mediaIdsAll.filter((m) =>
      (!fMedia || String(m.mediaId) === fMedia) &&
      (!mediaOrderIdsMatchingFilter || mediaOrderIdsMatchingFilter.has(m.mediaOrderId as number))), (m) => m.name),
    [fMedia, mediaOrderIdsMatchingFilter, mediaIdsAll],
  );

  const rows = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return mediaIdsAll.filter((m) => {
      if (fMedia && String(m.mediaId) !== fMedia) return false;
      if (mediaOrderIdsMatchingFilter && !mediaOrderIdsMatchingFilter.has(m.mediaOrderId as number)) return false;
      if (fMediaId && String(m.id) !== fMediaId) return false;
      if (fType && typeOf(m) !== fType) return false;
      if (fPrice && String(m.unitPrice ?? '') !== fPrice) return false;
      // Mặc định hiện cả link đã 下线; fStatus điều khiển confirmed/unconfirmed — theo id đã có ít nhất 1 record trong khoảng.
      if (fStatus === 'confirmed' && ![...savedIds].some((k) => k.startsWith(`${m.id}|`))) return false;
      if (fStatus === 'unconfirmed' && [...savedIds].some((k) => k.startsWith(`${m.id}|`))) return false;
      if (lc) {
        const hay = `${m.name} ${refName('media', m.mediaId)} ${refName('mediaOrders', m.mediaOrderId)} ${refName('advertisers', m.advertiserId)} ${refName('adOrders', m.adOrderId)} ${refName('adIds', m.adIdId)}`.toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    });
  }, [mediaIdsAll, fMedia, mediaOrderIdsMatchingFilter, fMediaId, fType, fPrice, fStatus, q, savedIds]);

  const [pageSize, setPageSize] = useState(10);

  // Mỗi dòng = 1 (mediaId, ngày) cho mỗi ngày trong [from, to]; record cũ (nếu có) khớp theo ngày.
  // Trước đây chỉ tạo dòng cho ngày CÓ record nên sót ngày chưa nhập giữa range.
  const cellRows = useMemo(() => {
    const out: { m: Row; cellDate: string; key: string }[] = [];
    // Ngày là khóa sắp xếp chính để danh sách luôn chạy liên tiếp
    // từ ngày cũ đến ngày mới, không quay lại ngày đầu ở mỗi media.
    const orderedRows = sortByGroupedLabel(rows, (m) => m.name);
    const orderedDates = dateDir === 1 ? datesInRange : [...datesInRange].reverse();
    for (const d of orderedDates) {
      for (const m of orderedRows) out.push({ m, cellDate: d, key: `${m.id}|${d}` });
    }
    return out;
  }, [rows, datesInRange, dateDir]);

  const totalRows = cellRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = cellRows.slice((curPage - 1) * pageSize, curPage * pageSize);

  const priceOptions = useMemo(
    () => Array.from(new Set(mediaIdsAll.map((m) => Number(m.unitPrice) || 0))).sort((a, b) => a - b),
    [mediaIdsAll],
  );

  // Lưu lượng/quyết toán lấy từ nhập liệu nhà QC; logic tính dùng chung với g4d ở lib/mediaSync.
  const calc = calcMediaCell;

  const buildPayload = (m: Row, cellDate: string) => {
    const c = calc(m, cellDate);
    return {
      date: cellDate, objectId: m.name, mediaIdId: m.id, mediaId: m.mediaId, mediaOrderId: m.mediaOrderId, adIdId: m.adIdId,
      advertiserId: m.advertiserId, adOrderId: m.adOrderId,
      // Giữ null cho ô CHƯA nhập từ thượng nguồn (spec 07-2026: quyết toán 0 là giá trị hợp lệ).
      type: c.type, unitPrice: c.unitPrice, traffic: c.traffic === '' ? null : Number(c.traffic),
      settlement: c.settlement === '' ? null : Number(c.settlement),
      coefficient: c.coef, payable: c.payable ?? 0, shareRate: c.accountShare, actual: c.netPay ?? 0, receivable: c.payable ?? 0,
      revenue: c.payable ?? 0, cost: c.netPay ?? 0, clicks: c.traffic === '' ? null : Number(c.traffic), source: 'Media', status: true,
    };
  };

  const recordOf = (m: Row, cellDate: string) =>
    getAll(COLLECTION).find((r) => String(r.date) === cellDate && (r.mediaIdId === m.id || r.objectId === m.name));

  const saveRow = (m: Row, cellDate: string) => {
    const existing = recordOf(m, cellDate);
    if (existing) update(COLLECTION, existing.id, buildPayload(m, cellDate));
    else create(COLLECTION, buildPayload(m, cellDate) as Omit<Row, 'id'>);
    setSavedIds((s) => new Set(s).add(`${m.id}|${cellDate}`));
    toast(t('entry.savedRow'));
  };

  const sel = "h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-200";
  const readVal = (v: number | string) => (v === '' || v == null ? <span className="text-gray-300">—</span> : <span className="text-gray-600">{Number(v).toLocaleString()}</span>);

  const headers = [
    t('col.stt'), t('col.date'), t('col.media'), t('col.mediaOrder'), t('col.type'), t('col.mediaId'),
    t('entry.unitShare'), t('entry.traffic'), t('entry.settlement'), t('entry.coefficient'),
    t('entry.payable'), t('col.accountShare'), t('entry.netPay'), t('common.status'), t('common.actions'),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-xs font-semibold tracking-widest text-cyan-500">{t('entry.eyebrow')}</div>
          <h1 className="text-xl font-bold text-gray-800">{t('menu.g3c')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('entry.forDate')}: <span className="font-medium text-gray-700">{from}{from !== to ? ` ~ ${to}` : ''}</span> · <span className="text-gray-400">{t('entry.traffic')}/{t('entry.settlement')} {t('entry.fromAdv')}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-start">
          <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          <select value={fMedia} onChange={(e) => { setFMedia(e.target.value); setFOrder(''); setFMediaId(''); }} className={sel}>
            <option value="">{t('entry.chooseMedia')}</option>
            {mediaOpts.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
          </select>
          <select value={fOrder} onChange={(e) => { setFOrder(e.target.value); setFMediaId(''); }} className={sel}>
            <option value="">{t('entry.chooseMediaOrder')}</option>
            {orderOpts.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>
          <select value={fMediaId} onChange={(e) => setFMediaId(e.target.value)} className={sel}>
            <option value="">{t('entry.chooseMediaId')}</option>
            {mediaIdOpts.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
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
            <option value="all">{t('entry.allStatus')}</option>
            {sortByGroupedLabel([
              { value: 'confirmed', label: t('entry.confirmed') },
              { value: 'unconfirmed', label: t('entry.unconfirmed') },
            ], (o) => o.label).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width={16} height={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.searchPh')}
              className="h-9 pl-8 pr-3 rounded-lg border border-gray-200 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-cyan-200" />
          </div>
          <button onClick={load}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600">
            <IconDownload width={16} height={16} /> {t('entry.load')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-220px)]">
          <table className="w-full text-sm [&_th]:text-center [&_td]:text-center">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-gray-200 bg-brand-dark border-b border-brand-dark2">
                {headers.map((h, i) => (
                  <th key={i} onClick={i === 1 ? () => setDateDir((d) => (d === 1 ? -1 : 1)) : undefined}
                    className={`px-3 py-2.5 font-bold uppercase text-[11px] tracking-wide whitespace-nowrap ${i === 1 ? 'cursor-pointer select-none' : ''}`}>
                    {h}
                    {i === 1 && (
                      <span className="inline-flex flex-col ml-1 text-[8px] leading-none align-middle">
                        <span className={dateDir === 1 ? 'text-cyan-300' : 'text-gray-500'}>▲</span>
                        <span className={dateDir === -1 ? 'text-cyan-300' : 'text-gray-500'}>▼</span>
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cellRows.length === 0 ? (
                <tr><td colSpan={headers.length} className="px-3 py-12 text-center text-gray-400">{t('common.noData')}</td></tr>
              ) : (
                <>
                  {pageRows.map(({ m, cellDate, key }, i) => {
                    const c = calc(m, cellDate);
                    const isOnline = m.status !== false;
                    const existing = recordOf(m, cellDate);
                    const isSaved = savedIds.has(key) && !!existing && !isMediaRecordStale(existing);
                    return (
                      <tr key={key} className="border-b border-gray-50 hover:bg-cyan-50/30">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-400">{(curPage - 1) * pageSize + i + 1}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{dayMonth(cellDate)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{refName('media', m.mediaId)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{refName('mediaOrders', m.mediaOrderId)}</td>
                        <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">{c.type}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{m.name}</td>
                        <td className="px-3 py-2">
                          <RateEditor value={c.unitPrice} workingDate={cellDate} suffix={c.type === 'CPS' ? '%' : ''} integer={c.type === 'CPS'} disabled={!canEdit}
                            onSet={(v, eff) => { setRate('mediaId', m.id, 'unitPrice', v, eff); toast(t('entry.effSaved')); }} />
                        </td>
                        <td className="px-3 py-2 text-right">{c.type === 'CPS' ? money2(Number(c.traffic) || 0) : readVal(c.traffic)}</td>
                        <td className="px-3 py-2 text-right">{readVal(c.settlement)}</td>
                        <td className="px-3 py-2">
                          <RateEditor value={Number((c.coef * 100).toFixed(2))} workingDate={cellDate} suffix="%" disabled={!canEdit}
                            onSet={(v, eff) => { setRate('mediaId', m.id, 'coefficient', v / 100, eff); toast(t('entry.effSaved')); }} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right font-medium">
                          {c.payable == null ? <span className="text-gray-300">—</span> : <span className="text-gray-700">{money(c.payable)}</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <RateEditor value={c.accountShare} workingDate={cellDate} suffix="%" disabled={!canEdit}
                            onSet={(v, eff) => { setRate('mediaId', m.id, 'profitShare', v, eff); toast(t('entry.effSaved')); }} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right font-semibold">
                          {c.netPay == null ? <span className="text-gray-300">0</span> : <span className="text-emerald-600">{money(c.netPay)}</span>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                            {isOnline ? t('entry.online') : t('entry.offline')}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {/* Cùng chữ "Xác nhận"; đã lưu → disabled, còn thay đổi → bấm được (spec 07-2026). */}
                          <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                            {(canCreate || canEdit) && (
                              <button onClick={() => saveRow(m, cellDate)} disabled={isSaved}
                                className={`h-7 px-2.5 rounded-lg text-xs font-medium ${isSaved ? 'bg-gray-100 text-emerald-700 cursor-default' : 'bg-emerald-500 text-white hover:bg-emerald-600'}`}>
                                {t('entry.saveRow')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
        <Pager total={totalRows} page={curPage} totalPages={totalPages} pageSize={pageSize}
          onPage={setPage} onPageSize={setPageSize} />
      </div>
    </div>
  );
}
