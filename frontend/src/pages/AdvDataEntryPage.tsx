import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { useCollection, getAll, create, update, refName, effectiveValue, setRate, type Row } from '../data/store';
import { nullableNumber, receivableOf, round3OrNull, type BillingInputs } from '../lib/billing';
import { Pager } from '../components/Pager';
import { RateEditor } from '../components/RateEditor';
import { DateRangePicker } from '../components/DateRangePicker';
import { IconSearch, IconDownload, IconUpload } from '../components/icons';
import { dayMonth, defaultDateRange, useDatesInRange, yesterdayRange } from '../lib/date';
import { sortByGroupedLabel } from '../lib/optionSort';

const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

type Draft = BillingInputs;

interface Props { screen?: string; collection?: string; source?: string; titleKey?: string; ai?: boolean }

export function AdvDataEntryPage({
  screen = 'g3b', collection = 'importAdv', source = 'Advertiser', titleKey = 'menu.g3b', ai = false,
}: Props = {}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();
  const COLLECTION = collection;
  // re-render when source data changes
  useCollection(COLLECTION);
  useCollection('rates'); // lịch sử đơn giá theo ngày
  const adIdsAll = useCollection('adIds');

  const [defaultFrom, defaultTo] = screen === 'g3b' ? yesterdayRange() : defaultDateRange();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const datesInRange = useDatesInRange(from, to);
  const [fAdv, setFAdv] = useState('');
  const [fOrder, setFOrder] = useState('');
  const [fAdId, setFAdId] = useState('');
  const [fType, setFType] = useState('');
  const [fPrice, setFPrice] = useState('');
  const [fStatus, setFStatus] = useState<'all' | 'online' | 'offline'>('all');
  const [q, setQ] = useState('');

  const [draft, setDraft] = useState<Record<string, Draft>>({});
  // Sort cột ngày: mặc định TĂNG dần (spec docx 07-2026), click header để đảo chiều.
  const [dateDir, setDateDir] = useState<1 | -1>(1);
  // Phân trang thống nhất toàn site: mặc định 10, chọn 10/30/50 (spec 07-2026).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ key: string; field: 'traffic' | 'settlement' } | null>(null);

  const canCreate = can(screen, 'create');
  const canEdit = can(screen, 'edit');

  // Load saved values for the selected range into the editable grid.
  // Mỗi ad có 1 dòng / ngày trong [from, to]; record cũ (nếu có) điền vào đúng dòng của ngày đó.
  // Trước đây chỉ tạo dòng cho ngày CÓ record nên sót ngày chưa nhập giữa range.
  const load = () => {
    const next: Record<string, Draft> = {};
    const saved = new Set<string>();
    const records = getAll(COLLECTION);
    for (const ad of getAll('adIds')) {
      const adRecs = records.filter((r) => r.adIdId === ad.id || r.objectId === ad.name);
      for (const d of datesInRange) {
        const rec = adRecs.find((r) => String(r.date) === d);
        const key = `${ad.id}|${d}`;
        next[key] = {
          unitPrice: rec?.unitPrice ?? ad.unitPrice ?? '',
          traffic: rec?.traffic ?? rec?.clicks ?? '',
          settlement: rec?.settlement ?? '',
        };
        if (rec) saved.add(key);
      }
    }
    setDraft(next);
    setSavedIds(saved);
    setEditing(null);
  };

  useEffect(load, [from, to]); // reload when range changes
  useEffect(() => { setPage(1); }, [from, to, fAdv, fOrder, fAdId, fType, fPrice, fStatus, q, dateDir]);

  // Cascading dropdown option lists
  const advOpts = sortByGroupedLabel(getAll('advertisers'), (r) => r.name);
  const orderOpts = useMemo(
    () => {
      const seen = new Set<string>();
      return sortByGroupedLabel(getAll('adOrders').filter((o) => {
        if (fAdv && String(o.advertiserId) !== fAdv) return false;
        const key = String(o.name ?? '').trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }), (o) => o.name);
    },
    [fAdv, adIdsAll],
  );
  // fOrder giữ id của 1 đơn đại diện, nhưng dropdown đã gộp theo TÊN (nhiều nhà QC
  // có thể cùng tên đơn) → lọc phải khớp MỌI đơn cùng tên, không chỉ 1 id.
  const orderIdsMatchingFilter = useMemo(() => {
    if (!fOrder) return null;
    const picked = getAll('adOrders').find((o) => String(o.id) === fOrder);
    const name = norm(picked?.name);
    return new Set(getAll('adOrders').filter((o) => norm(o.name) === name).map((o) => o.id));
  }, [fOrder, adIdsAll]);

  const adIdOpts = useMemo(
    () => sortByGroupedLabel(
      adIdsAll.filter((a) => (!fAdv || String(a.advertiserId) === fAdv) && (!orderIdsMatchingFilter || orderIdsMatchingFilter.has(a.adOrderId as number))),
      (a) => a.name,
    ),
    [fAdv, orderIdsMatchingFilter, adIdsAll],
  );

  // Visible rows
  const rows = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return adIdsAll.filter((ad) => {
      if (fAdv && String(ad.advertiserId) !== fAdv) return false;
      if (orderIdsMatchingFilter && !orderIdsMatchingFilter.has(ad.adOrderId as number)) return false;
      if (fAdId && String(ad.id) !== fAdId) return false;
      if (fType && ad.type !== fType) return false;
      if (fPrice && String(ad.unitPrice ?? '') !== fPrice) return false;
      const online = ad.status !== false;
      if (fStatus === 'online' && !online) return false;
      if (fStatus === 'offline' && online) return false;
      if (lc) {
        const hay = `${ad.name} ${refName('advertisers', ad.advertiserId)} ${refName('adOrders', ad.adOrderId)}`.toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    });
  }, [adIdsAll, fAdv, orderIdsMatchingFilter, fAdId, fType, fPrice, fStatus, q]);

  // Mỗi dòng = 1 (ad, cellDate) lấy từ draft keys; sort theo ngày (dateDir) rồi ad.
  const cellRows = useMemo(() => {
    const out: { ad: Row; cellDate: string; key: string }[] = [];
    const adById = new Map(rows.map((ad) => [String(ad.id), ad] as const));
    const keys = Object.keys(draft).sort((a, b) => {
      const da = a.split('|')[1] ?? '';
      const db = b.split('|')[1] ?? '';
      if (da !== db) return da.localeCompare(db) * dateDir;
      return a.localeCompare(b);
    });
    for (const k of keys) {
      const sep = k.indexOf('|');
      const adId = k.slice(0, sep);
      const cellDate = k.slice(sep + 1);
      const ad = adById.get(adId);
      if (!ad) continue; // ad đã bị ẩn bởi filter
      out.push({ ad, cellDate, key: k });
    }
    return out;
  }, [rows, draft, dateDir]);

  const priceOptions = useMemo(
    () => Array.from(new Set(adIdsAll.map((a) => Number(a.unitPrice) || 0))).sort((a, b) => a - b),
    [adIdsAll],
  );

  const totalRows = cellRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = cellRows.slice((curPage - 1) * pageSize, curPage * pageSize);

  const setCell = (key: string, field: keyof Draft, value: string) => {
    setDraft((d) => ({ ...d, [key]: { ...d[key], [field]: value === '' ? '' : Number(value) } }));
    setSavedIds((s) => { const next = new Set(s); next.delete(key); return next; });
  };

  // Đơn giá/Tỷ lệ có hiệu lực tại ngày đang nhập (theo lịch sử versioning).
  const priceOf = (ad: Row, workingDate: string) => effectiveValue('adId', ad.id, 'unitPrice', workingDate, Number(ad.unitPrice) || 0);

  const recordOf = (ad: Row, cellDate: string) =>
    getAll(COLLECTION).find((r) => String(r.date) === cellDate && (r.adIdId === ad.id || r.objectId === ad.name));

  // Bản ghi đã lưu còn khớp số hiện hành không? Đơn giá đổi hiệu lực sau khi lưu →
  // phải thu lệch → nút "Lưu" sáng lại nhắc lưu số mới (spec 07-2026: 操作部分高亮).
  const isStale = (existing: Row, ad: Row, cellDate: string) => {
    const price = priceOf(ad, cellDate);
    const fresh = round3OrNull(receivableOf(ad.type, {
      unitPrice: price, traffic: existing.traffic ?? existing.clicks ?? '', settlement: existing.settlement ?? '',
    }));
    return Number(existing.unitPrice ?? 0) !== price || nullableNumber(existing.receivable) !== fresh;
  };

  const saveRow = (ad: Row, cellDate: string) => {
    const key = `${ad.id}|${cellDate}`;
    const d = draft[key] || { unitPrice: '', traffic: '', settlement: '' };
    const price = priceOf(ad, cellDate);
    const receivable = round3OrNull(receivableOf(ad.type, { unitPrice: price, traffic: d.traffic, settlement: d.settlement }));
    const payload = {
      date: cellDate, objectId: ad.name, adIdId: ad.id, advertiserId: ad.advertiserId, adOrderId: ad.adOrderId,
      // Giữ null cho ô CHƯA nhập — ép về 0 sẽ biến "chưa nhập" thành "đã nhập 0"
      // và làm phải thu rớt về 0 sai (spec 07-2026: quyết toán 0 là giá trị hợp lệ).
      type: ad.type, unitPrice: price, traffic: nullableNumber(d.traffic),
      settlement: nullableNumber(d.settlement), receivable,
      // cost = 0: phía NQC chỉ có THU (phải thu); quyết toán là CƠ SỞ tính phải thu,
      // không phải chi phí. Chi cho media nằm ở importMedia (spec: Lợi nhuận = Thu − Chi media − Thuế).
      revenue: receivable, cost: 0, clicks: nullableNumber(d.traffic),
      source, status: true,
    };
    const existing = recordOf(ad, cellDate);
    if (existing) update(COLLECTION, existing.id, payload);
    else create(COLLECTION, payload as Omit<Row, 'id'>);
    setSavedIds((s) => new Set(s).add(key));
    toast(t('entry.savedRow'));
  };

  // AI auto-fill: simulate fetching traffic/settlement from an external source for visible rows.
  // Ghi vào dòng đầu tiên (cellDate = from) của mỗi ad đang hiển thị.
  const aiFill = () => {
    setDraft((d) => {
      const next = { ...d };
      for (const ad of rows) {
        const key = `${ad.id}|${from}`;
        const cur = next[key] || { unitPrice: ad.unitPrice ?? '', traffic: '', settlement: '' };
        next[key] = {
          unitPrice: cur.unitPrice === '' ? (ad.unitPrice ?? 0) : cur.unitPrice,
          traffic: 800 + Math.floor(Math.random() * 6000),
          settlement: 1000 + Math.floor(Math.random() * 9000),
        };
      }
      return next;
    });
    toast(`${source}: ${t('entry.aiFilled')}`);
  };

  const sel = "h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-200";

  // Click-to-enter cell for traffic / settlement
  const valueCell = (key: string, field: 'traffic' | 'settlement') => {
    const v = draft[key]?.[field];
    const isEditing = editing?.key === key && editing.field === field;
    if (isEditing) {
      return (
        <input autoFocus type="number" defaultValue={v === '' || v == null ? '' : String(v)}
          onBlur={(e) => { setCell(key, field, e.target.value); setEditing(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-24 h-7 px-2 rounded border border-cyan-300 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200" />
      );
    }
    if (v === '' || v == null) {
      return (
        <button disabled={!canEdit} onClick={() => setEditing({ key, field })}
          className="h-7 px-2 rounded border border-dashed border-gray-300 text-xs text-gray-400 hover:border-cyan-300 hover:text-cyan-500 disabled:opacity-50">
          + {t('entry.value')}
        </button>
      );
    }
    return (
      <button disabled={!canEdit} onClick={() => setEditing({ key, field })}
        className="h-7 px-2 rounded text-sm font-medium text-gray-700 hover:bg-cyan-50 disabled:opacity-60">
        {Number(v).toLocaleString()}
      </button>
    );
  };

  return (
    <div>
      {/* Header + toolbar */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-xs font-semibold tracking-widest text-cyan-500">{t('entry.eyebrow')}</div>
          <h1 className="text-xl font-bold text-gray-800">{t(titleKey)}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('entry.forDate')}: <span className="font-medium text-gray-700">{from}{from !== to ? ` ~ ${to}` : ''}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-start">
          <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          <select value={fAdv} onChange={(e) => { setFAdv(e.target.value); setFOrder(''); setFAdId(''); }} className={sel}>
            <option value="">{t('entry.chooseAdv')}</option>
            {advOpts.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
          </select>
          <select value={fOrder} onChange={(e) => { setFOrder(e.target.value); setFAdId(''); }} className={sel}>
            <option value="">{t('entry.chooseOrder')}</option>
            {orderOpts.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>
          <select value={fAdId} onChange={(e) => setFAdId(e.target.value)} className={sel}>
            <option value="">{t('entry.chooseAdId')}</option>
            {adIdOpts.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
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
              { value: 'online', label: t('entry.online') },
              { value: 'offline', label: t('entry.offline') },
            ], (o) => o.label).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width={16} height={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.searchPh')}
              className="h-9 pl-8 pr-3 rounded-lg border border-gray-200 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-cyan-200" />
          </div>
          {ai && canEdit && (
            <button onClick={aiFill}
              className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-violet-500 text-white text-sm font-medium hover:bg-violet-600">
              <IconUpload width={16} height={16} /> {t('entry.aiFill')}
            </button>
          )}
          <button onClick={load}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600">
            <IconDownload width={16} height={16} /> {t('entry.load')}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-220px)]">
          <table className="w-full text-sm [&_th]:text-center [&_td]:text-center">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-gray-200 bg-brand-dark border-b border-brand-dark2">
                {[t('col.stt'), t('col.date'), t('col.advertiser'), t('col.adOrder'), t('col.type'), t('col.adId'),
                  t('entry.unitShare'), t('entry.traffic'), t('entry.settlement'), t('entry.receivable'),
                  t('common.status'), t('common.actions')].map((h, i) => (
                  <th key={i} onClick={i === 1 ? () => setDateDir((d) => (d === 1 ? -1 : 1)) : undefined}
                    className={`px-3 py-2.5 font-bold uppercase text-[11px] tracking-wide whitespace-nowrap ${i === 1 ? 'cursor-pointer select-none hover:text-white' : ''}`}>
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
              {cellRows.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-12 text-center text-gray-400">{t('common.noData')}</td></tr>
              )}
              {pageRows.map(({ ad, cellDate, key }, i) => {
                const d = draft[key] || { unitPrice: ad.unitPrice ?? '', traffic: '', settlement: '' };
                const price = priceOf(ad, cellDate);
                const receivable = receivableOf(ad.type, { unitPrice: price, traffic: d.traffic, settlement: d.settlement });
                const isOnline = ad.status !== false;
                const existing = recordOf(ad, cellDate);
                const isSaved = savedIds.has(key) && !!existing && !isStale(existing, ad, cellDate);
                return (
                  <tr key={key} className="border-b border-gray-50 hover:bg-cyan-50/30">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-400">{(curPage - 1) * pageSize + i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{dayMonth(cellDate)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{refName('advertisers', ad.advertiserId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{refName('adOrders', ad.adOrderId)}</td>
                    <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">{ad.type}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{ad.name}</td>
                    <td className="px-3 py-2">
                      <RateEditor value={price} workingDate={cellDate} suffix={ad.type === 'CPS' ? '%' : ''} integer={ad.type === 'CPS'} disabled={!canEdit}
                        onSet={(v, eff) => { setRate('adId', ad.id, 'unitPrice', v, eff); toast(t('entry.effSaved')); }} />
                    </td>
                    <td className="px-3 py-2">{valueCell(key, 'traffic')}</td>
                    <td className="px-3 py-2">{valueCell(key, 'settlement')}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-semibold text-right">
                      {receivable == null ? <span className="text-gray-300">—</span> : <span className="text-emerald-600">{money(receivable)}</span>}
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
                        {canCreate || canEdit ? (
                          <button onClick={() => saveRow(ad, cellDate)} disabled={isSaved}
                            className={`h-7 px-2.5 rounded-lg text-xs font-medium ${isSaved ? 'bg-gray-100 text-emerald-700 cursor-default' : 'bg-emerald-500 text-white hover:bg-emerald-600'}`}>
                            {t('entry.saveRow')}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager total={totalRows} page={curPage} totalPages={totalPages} pageSize={pageSize}
          onPage={setPage} onPageSize={setPageSize} />
      </div>
    </div>
  );
}
