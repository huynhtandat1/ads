import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { useCollection, getAll, create, update, refName, effectiveValue, setRate, type Row } from '../data/store';
import { receivableOf } from '../lib/billing';
import { RateEditor } from '../components/RateEditor';
import { IconSearch, IconDownload } from '../components/icons';
import { yesterdayStr } from '../lib/date';

const COLLECTION = 'importMedia';
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

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

  const [date, setDate] = useState(yesterdayStr());
  const [fAdv, setFAdv] = useState('');
  const [fAdId, setFAdId] = useState('');
  const [fMedia, setFMedia] = useState('');
  const [fOrder, setFOrder] = useState('');
  const [fMediaId, setFMediaId] = useState('');
  const [fType, setFType] = useState('');
  const [fPrice, setFPrice] = useState('');
  const [fStatus, setFStatus] = useState<'all' | 'confirmed' | 'unconfirmed'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());

  const canCreate = can(screen, 'create');
  const canEdit = can(screen, 'edit');

  const load = () => {
    const saved = new Set<number>();
    const records = getAll(COLLECTION);
    for (const m of getAll('mediaIds')) {
      if (records.find((r) => r.date === date && (r.mediaIdId === m.id || r.objectId === m.name))) saved.add(m.id);
    }
    setSavedIds(saved);
  };
  useEffect(load, [date]);
  useEffect(() => { setPage(1); }, [date, fAdv, fAdId, fMedia, fOrder, fMediaId, fType, fPrice, fStatus, q]);

  const advOpts = getAll('advertisers');
  const adIdOpts = useMemo(() => getAll('adIds').filter((a) => !fAdv || String(a.advertiserId) === fAdv), [fAdv, mediaIdsAll]);
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
  const mediaIdOpts = useMemo(
    () => mediaIdsAll.filter((m) =>
      (!fAdv || String(m.advertiserId) === fAdv) && (!fAdId || String(m.adIdId) === fAdId) &&
      (!fMedia || String(m.mediaId) === fMedia) && (!fOrder || String(m.mediaOrderId) === fOrder)),
    [fAdv, fAdId, fMedia, fOrder, mediaIdsAll],
  );

  const rows = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return mediaIdsAll.filter((m) => {
      if (fAdv && String(m.advertiserId) !== fAdv) return false;
      if (fAdId && String(m.adIdId) !== fAdId) return false;
      if (fMedia && String(m.mediaId) !== fMedia) return false;
      if (fOrder && String(m.mediaOrderId) !== fOrder) return false;
      if (fMediaId && String(m.id) !== fMediaId) return false;
      if (fType && typeOf(m) !== fType) return false;
      if (fPrice && String(m.unitPrice ?? '') !== fPrice) return false;
      // Mặc định hiện cả link đã 下线; fStatus điều khiển confirmed/unconfirmed.
      if (fStatus === 'confirmed' && !savedIds.has(m.id)) return false;
      if (fStatus === 'unconfirmed' && savedIds.has(m.id)) return false;
      if (lc) {
        const hay = `${m.name} ${refName('media', m.mediaId)} ${refName('mediaOrders', m.mediaOrderId)} ${refName('advertisers', m.advertiserId)} ${refName('adOrders', m.adOrderId)} ${refName('adIds', m.adIdId)}`.toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    });
  }, [mediaIdsAll, fAdv, fAdId, fMedia, fOrder, fMediaId, fType, fPrice, fStatus, q, savedIds]);

  const priceOptions = useMemo(
    () => Array.from(new Set(mediaIdsAll.map((m) => Number(m.unitPrice) || 0))).sort((a, b) => a - b),
    [mediaIdsAll],
  );

  // Lưu lượng/quyết toán lấy từ nhập liệu nhà QC theo ID quảng cáo (adIdId) + ngày.
  const advOf = (m: Row) => getAll('importAdv').find((r) => r.date === date && r.adIdId === m.adIdId);

  const calc = (m: Row) => {
    const adv = advOf(m);
    const traffic = adv ? (adv.traffic ?? adv.clicks ?? '') : '';
    const settlement = adv ? (adv.settlement ?? '') : '';
    const type = typeOf(m);
    const unitPrice = effectiveValue('mediaId', m.id, 'unitPrice', date, Number(m.unitPrice) || 0);
    const coef = effectiveValue('mediaId', m.id, 'coefficient', date, 1);
    const accountShare = effectiveValue('mediaId', m.id, 'profitShare', date, Number(m.profitShare) || 0);
    const receivable = receivableOf(type, { unitPrice, traffic, settlement });
    const payable = receivable == null ? null : receivable * coef;       // Số tiền phải trả
    const netPay = payable == null ? null : payable * (accountShare / 100); // Số tiền thực trả
    return { type, traffic, settlement, unitPrice, coef, accountShare, payable, netPay };
  };

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = rows.slice((curPage - 1) * pageSize, curPage * pageSize);
  const dayTotal = rows.reduce((s, m) => s + (calc(m).netPay ?? 0), 0);

  const buildPayload = (m: Row) => {
    const c = calc(m);
    return {
      date, objectId: m.name, mediaIdId: m.id, mediaId: m.mediaId, mediaOrderId: m.mediaOrderId, adIdId: m.adIdId,
      advertiserId: m.advertiserId, adOrderId: m.adOrderId,
      type: c.type, unitPrice: c.unitPrice, traffic: Number(c.traffic) || 0, settlement: Number(c.settlement) || 0,
      coefficient: c.coef, payable: c.payable ?? 0, shareRate: c.accountShare, actual: c.netPay ?? 0, receivable: c.payable ?? 0,
      revenue: c.payable ?? 0, cost: c.netPay ?? 0, clicks: Number(c.traffic) || 0, source: 'Media', status: true,
    };
  };

  const saveRow = (m: Row) => {
    const existing = getAll(COLLECTION).find((r) => r.date === date && (r.mediaIdId === m.id || r.objectId === m.name));
    if (existing) update(COLLECTION, existing.id, buildPayload(m));
    else create(COLLECTION, buildPayload(m) as Omit<Row, 'id'>);
    setSavedIds((s) => new Set(s).add(m.id));
    toast(t('entry.savedRow'));
  };

  const confirmAll = () => { rows.forEach(saveRow); toast(t('entry.savedAll')); };

  const sel = "h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-200";
  const readVal = (v: number | '') => (v === '' || v == null ? <span className="text-gray-300">—</span> : <span className="text-gray-600">{Number(v).toLocaleString()}</span>);

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
          <p className="text-sm text-gray-500 mt-0.5">{t('entry.forDate')}: <span className="font-medium text-gray-700">{date}</span> · <span className="text-gray-400">{t('entry.traffic')}/{t('entry.settlement')} {t('entry.fromAdv')}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={sel} />
          <select value={fAdv} onChange={(e) => { setFAdv(e.target.value); setFAdId(''); setFMediaId(''); }} className={sel}>
            <option value="">{t('entry.chooseAdv')}</option>
            {advOpts.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
          </select>
          <select value={fAdId} onChange={(e) => { setFAdId(e.target.value); setFMediaId(''); }} className={sel}>
            <option value="">{t('entry.chooseAdId')}</option>
            {adIdOpts.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
          </select>
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
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-gray-200 bg-brand-dark border-b border-brand-dark2">
                {headers.map((h, i) => (
                  <th key={i} className="px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={headers.length} className="px-3 py-12 text-center text-gray-400">{t('common.noData')}</td></tr>
              ) : (
                <>
                  <tr className="bg-brand-dark2 text-white">
                    <td className="px-3 py-2 font-semibold whitespace-nowrap" colSpan={6}>📅 {date}</td>
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

                  {pageRows.map((m, i) => {
                    const c = calc(m);
                    const isOnline = m.status !== false;
                    const isSaved = savedIds.has(m.id);
                    return (
                      <tr key={m.id} className="border-b border-gray-50 hover:bg-cyan-50/30">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-400">{(curPage - 1) * pageSize + i + 1}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{date}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{refName('media', m.mediaId)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{refName('mediaOrders', m.mediaOrderId)}</td>
                        <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">{c.type}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{m.name}</td>
                        <td className="px-3 py-2">
                          <RateEditor value={c.unitPrice} workingDate={date} suffix={c.type === 'CPS' ? '%' : ''} integer={c.type === 'CPS'} disabled={!canEdit}
                            onSet={(v, eff) => { setRate('mediaId', m.id, 'unitPrice', v, eff); toast(t('entry.effSaved')); }} />
                        </td>
                        <td className="px-3 py-2 text-right">{readVal(c.traffic)}</td>
                        <td className="px-3 py-2 text-right">{readVal(c.settlement)}</td>
                        <td className="px-3 py-2">
                          <RateEditor value={Number((c.coef * 100).toFixed(2))} workingDate={date} suffix="%" disabled={!canEdit}
                            onSet={(v, eff) => { setRate('mediaId', m.id, 'coefficient', v / 100, eff); toast(t('entry.effSaved')); }} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right font-medium">
                          {c.payable == null ? <span className="text-gray-300">—</span> : <span className="text-gray-700">{money(c.payable)}</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <RateEditor value={c.accountShare} workingDate={date} suffix="%" disabled={!canEdit}
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
                              <button onClick={() => saveRow(m)}
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
          <span>{t('common.total')} {rows.length} {t('common.rows')}</span>
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
