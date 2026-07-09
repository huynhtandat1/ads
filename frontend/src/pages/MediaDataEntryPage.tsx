import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { useCollection, getAll, create, update, refName, effectiveValue, setRate, type Row } from '../data/store';
import { receivableOf } from '../lib/billing';
import { round3 } from '../lib/format';
import { RateEditor } from '../components/RateEditor';
import { DateRangePicker } from '../components/DateRangePicker';
import { IconSearch, IconDownload } from '../components/icons';
import { inRange, useDatesInRange, yesterdayStr } from '../lib/date';

const COLLECTION = 'importMedia';
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Traffic CPS = giá trị đơn hàng (tiền) → luôn 2 chữ số thập phân, KHÔNG ký hiệu ¥.
const money2 = (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

const typeOf = (mid: Row): string => mid.type ?? getAll('adIds').find((a) => a.id === mid.adIdId)?.type ?? '-';

export function MediaDataEntryPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();
  const screen = 'g3c';
  useCollection(COLLECTION);
  useCollection('importAdv'); // lưu lượng/quyết toán đọc từ đây
  useCollection('rates');     // lịch sử đơn giá/hệ số/tỷ lệ chia TK
  const mediaIdsAll = useCollection('mediaIds');

  const [from, setFrom] = useState(yesterdayStr());
  const [to, setTo] = useState(yesterdayStr());
  const datesInRange = useDatesInRange(from, to);
  const [fMedia, setFMedia] = useState('');
  const [fOrder, setFOrder] = useState('');
  const [fMediaId, setFMediaId] = useState('');
  const [fType, setFType] = useState('');
  const [fPrice, setFPrice] = useState('');
  const [fStatus, setFStatus] = useState<'all' | 'confirmed' | 'unconfirmed'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
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

  const mediaOpts = getAll('media');
  const orderOpts = useMemo(() => {
    const seen = new Set<string>();
    return getAll('mediaOrders').filter((o) => {
      if (fMedia && String(o.mediaId) !== fMedia) return false;
      const key = String(o.name ?? '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
    () => mediaIdsAll.filter((m) =>
      (!fMedia || String(m.mediaId) === fMedia) &&
      (!mediaOrderIdsMatchingFilter || mediaOrderIdsMatchingFilter.has(m.mediaOrderId as number))),
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

  const pageSize = 10;

  // Mỗi dòng = 1 (mediaId, ngày) cho mỗi ngày trong [from, to]; record cũ (nếu có) khớp theo ngày.
  // Trước đây chỉ tạo dòng cho ngày CÓ record nên sót ngày chưa nhập giữa range.
  const cellRows = useMemo(() => {
    const out: { m: Row; cellDate: string; key: string }[] = [];
    for (const m of rows) {
      for (const d of datesInRange) out.push({ m, cellDate: d, key: `${m.id}|${d}` });
    }
    return out;
  }, [rows, datesInRange]);

  const totalRows = cellRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = cellRows.slice((curPage - 1) * pageSize, curPage * pageSize);

  const priceOptions = useMemo(
    () => Array.from(new Set(mediaIdsAll.map((m) => Number(m.unitPrice) || 0))).sort((a, b) => a - b),
    [mediaIdsAll],
  );

  // Lưu lượng/quyết toán lấy từ nhập liệu nhà QC theo ID quảng cáo (adIdId) + ngày của dòng.
  const advOf = (m: Row, cellDate: string) => getAll('importAdv').find((r) => String(r.date) === cellDate && r.adIdId === m.adIdId);

  const calc = (m: Row, cellDate: string) => {
    const adv = advOf(m, cellDate);
    const rawTraffic = adv ? Number(adv.traffic ?? adv.clicks ?? 0) : null;
    const rawSettlement = adv ? Number(adv.settlement ?? 0) : null;
    const type = typeOf(m);
    const unitPrice = effectiveValue('mediaId', m.id, 'unitPrice', cellDate, Number(m.unitPrice) || 0);
    const coef = effectiveValue('mediaId', m.id, 'coefficient', cellDate, 1);
    const accountShare = effectiveValue('mediaId', m.id, 'profitShare', cellDate, Number(m.profitShare) || 0);
    // Hệ số dữ liệu scale trực tiếp vào DỮ LIỆU:
    //   - Lưu lượng CPM/CPC/CPA = lượt (đếm) → NQC × hệ số, LÀM TRÒN XUỐNG (Math.floor)
    //     không tính lượt chưa đủ (1750×0.85=1487,5 → 1487).
    //   - Lưu lượng CPS = TIỀN (giá trị đơn hàng) → giữ 3 số lẻ (round3) để cộng dồn
    //     chính xác; hiển thị money() rút về 2 số lẻ.
    // Quyết toán là tiền nên cũng giữ 3 số lẻ.
    const traffic = rawTraffic == null ? '' : (type === 'CPS' ? round3(rawTraffic * coef) : Math.floor(rawTraffic * coef));
    const settlement = rawSettlement == null ? '' : round3(rawSettlement * coef);
    // Phải trả tính từ base ĐÃ áp hệ số (không nhân hệ số lần nữa). Tính giữ 3 số lẻ,
    // hiển thị money() lo phần rút về 2 số lẻ.
    const receivable = receivableOf(type, { unitPrice, traffic, settlement });
    const payable = receivable == null ? null : round3(receivable);          // Số tiền phải trả
    const netPay = payable == null ? null : round3(payable * (accountShare / 100)); // Số tiền thực trả
    return { type, traffic, settlement, unitPrice, coef, accountShare, payable, netPay };
  };

  const dayTotal = cellRows.reduce((s, { m, cellDate }) => s + (calc(m, cellDate).netPay ?? 0), 0);

  const buildPayload = (m: Row, cellDate: string) => {
    const c = calc(m, cellDate);
    return {
      date: cellDate, objectId: m.name, mediaIdId: m.id, mediaId: m.mediaId, mediaOrderId: m.mediaOrderId, adIdId: m.adIdId,
      advertiserId: m.advertiserId, adOrderId: m.adOrderId,
      type: c.type, unitPrice: c.unitPrice, traffic: Number(c.traffic) || 0, settlement: Number(c.settlement) || 0,
      coefficient: c.coef, payable: c.payable ?? 0, shareRate: c.accountShare, actual: c.netPay ?? 0, receivable: c.payable ?? 0,
      revenue: c.payable ?? 0, cost: c.netPay ?? 0, clicks: Number(c.traffic) || 0, source: 'Media', status: true,
    };
  };

  const saveRow = (m: Row, cellDate: string) => {
    const existing = getAll(COLLECTION).find((r) => String(r.date) === cellDate && (r.mediaIdId === m.id || r.objectId === m.name));
    if (existing) update(COLLECTION, existing.id, buildPayload(m, cellDate));
    else create(COLLECTION, buildPayload(m, cellDate) as Omit<Row, 'id'>);
    setSavedIds((s) => new Set(s).add(`${m.id}|${cellDate}`));
    toast(t('entry.savedRow'));
  };

  const confirmAll = () => { cellRows.forEach(({ m, cellDate }) => saveRow(m, cellDate)); toast(t('entry.savedAll')); };

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
        <div className="flex flex-wrap items-center gap-2 justify-end">
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
            {['CPM', 'CPC', 'CPA', 'CPS'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={fPrice} onChange={(e) => setFPrice(e.target.value)} className={sel}>
            <option value="">{t('report.unitPriceShort')}</option>
            {priceOptions.map((p) => <option key={p} value={String(p)}>{p}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value as typeof fStatus)} className={sel}>
            <option value="all">{t('entry.allStatus')}</option>
            <option value="confirmed">{t('entry.confirmed')}</option>
            <option value="unconfirmed">{t('entry.unconfirmed')}</option>
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
                  <th key={i} className="px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cellRows.length === 0 ? (
                <tr><td colSpan={headers.length} className="px-3 py-12 text-center text-gray-400">{t('common.noData')}</td></tr>
              ) : (
                <>
                  <tr className="bg-brand-dark2 text-white">
                    <td className="px-3 py-2 font-semibold whitespace-nowrap" colSpan={6}>📅 {from}{from !== to ? ` ~ ${to}` : ''}</td>
                    <td className="px-3 py-2" colSpan={6}>
                      <span className="text-gray-300 text-xs mr-2">{t('entry.dayTotal')}:</span>
                      <span className="font-bold text-cyan-300">{money(dayTotal)}</span>
                    </td>
                    <td className="px-3 py-2" colSpan={3}>
                      {(canCreate || canEdit) && (
                        <button onClick={confirmAll}
                          className="h-7 px-3 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600">
                          {t('entry.confirmAll')}
                        </button>
                      )}
                    </td>
                  </tr>

                  {pageRows.map(({ m, cellDate, key }, i) => {
                    const c = calc(m, cellDate);
                    const isOnline = m.status !== false;
                    const isSaved = savedIds.has(key);
                    return (
                      <tr key={key} className="border-b border-gray-50 hover:bg-cyan-50/30">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-400">{(curPage - 1) * pageSize + i + 1}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{cellDate}</td>
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
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            {(canCreate || canEdit) && (
                              <button onClick={() => saveRow(m, cellDate)}
                                className={`h-7 px-2.5 rounded-lg text-xs font-medium ${isSaved ? 'bg-gray-100 text-emerald-700' : 'bg-emerald-500 text-white hover:bg-emerald-600'}`}>
                                {isSaved ? t('entry.savedShort') : t('entry.saveRow')}
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
        <div className="flex items-center justify-between p-4 text-sm text-gray-500 border-t border-gray-100">
          <span>{t('common.total')} {totalRows} {t('common.rows')}</span>
          <div className="flex items-center gap-1">
            <button disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}
              className="h-8 px-3 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹</button>
            <span className="px-3">{curPage} / {totalPages}</span>
            <button disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}
              className="h-8 px-3 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">›</button>
          </div>
        </div>
      </div>
    </div>
  );
}
