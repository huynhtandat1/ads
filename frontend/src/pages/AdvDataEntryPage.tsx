import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { useCollection, getAll, create, update, refName, effectiveValue, setRate, type Row } from '../data/store';
import { receivableOf, type BillingInputs } from '../lib/billing';
import { RateEditor } from '../components/RateEditor';
import { LatestDataHint } from '../components/LatestDataHint';
import { IconSearch, IconDownload, IconUpload } from '../components/icons';
import { yesterdayStr } from '../lib/date';

const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

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

  const [date, setDate] = useState(yesterdayStr());
  const [fAdv, setFAdv] = useState('');
  const [fOrder, setFOrder] = useState('');
  const [fAdId, setFAdId] = useState('');
  const [fStatus, setFStatus] = useState<'all' | 'online' | 'offline'>('all');
  const [q, setQ] = useState('');

  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<{ id: number; field: 'traffic' | 'settlement' } | null>(null);

  const canCreate = can(screen, 'create');
  const canEdit = can(screen, 'edit');

  // Load saved values for the selected date into the editable grid.
  const load = () => {
    const next: Record<number, Draft> = {};
    const saved = new Set<number>();
    const records = getAll(COLLECTION);
    for (const ad of getAll('adIds')) {
      const rec = records.find((r) => r.date === date && (r.adIdId === ad.id || r.objectId === ad.name));
      next[ad.id] = {
        unitPrice: rec?.unitPrice ?? ad.unitPrice ?? '',
        traffic: rec?.traffic ?? rec?.clicks ?? '',
        settlement: rec?.settlement ?? '',
      };
      if (rec) saved.add(ad.id);
    }
    setDraft(next);
    setSavedIds(saved);
    setEditing(null);
  };

  useEffect(load, [date]); // reload when date changes

  // Cascading dropdown option lists
  const advOpts = getAll('advertisers');
  const orderOpts = useMemo(
    () => {
      const seen = new Set<string>();
      return getAll('adOrders').filter((o) => {
        if (fAdv && String(o.advertiserId) !== fAdv) return false;
        const key = `${o.advertiserId}::${String(o.name ?? '').trim().toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    [fAdv, adIdsAll],
  );
  const adIdOpts = useMemo(
    () => adIdsAll.filter((a) => (!fAdv || String(a.advertiserId) === fAdv) && (!fOrder || String(a.adOrderId) === fOrder)),
    [fAdv, fOrder, adIdsAll],
  );

  // Visible rows
  const rows = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return adIdsAll.filter((ad) => {
      if (fAdv && String(ad.advertiserId) !== fAdv) return false;
      if (fOrder && String(ad.adOrderId) !== fOrder) return false;
      if (fAdId && String(ad.id) !== fAdId) return false;
      const online = ad.status !== false;
      if (fStatus === 'online' && !online) return false;
      if (fStatus === 'offline' && online) return false;
      if (lc) {
        const hay = `${ad.name} ${refName('advertisers', ad.advertiserId)} ${refName('adOrders', ad.adOrderId)}`.toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    });
  }, [adIdsAll, fAdv, fOrder, fAdId, fStatus, q]);

  const setCell = (id: number, field: keyof Draft, value: string) => {
    setDraft((d) => ({ ...d, [id]: { ...d[id], [field]: value === '' ? '' : Number(value) } }));
  };

  // Đơn giá/Tỷ lệ có hiệu lực tại ngày đang nhập (theo lịch sử versioning).
  const priceOf = (ad: Row) => effectiveValue('adId', ad.id, 'unitPrice', date, Number(ad.unitPrice) || 0);

  const saveRow = (ad: Row) => {
    const d = draft[ad.id] || { unitPrice: '', traffic: '', settlement: '' };
    const price = priceOf(ad);
    const receivable = receivableOf(ad.type, { unitPrice: price, traffic: d.traffic, settlement: d.settlement }) ?? 0;
    const payload = {
      date, objectId: ad.name, adIdId: ad.id, advertiserId: ad.advertiserId, adOrderId: ad.adOrderId,
      type: ad.type, unitPrice: price, traffic: Number(d.traffic) || 0,
      settlement: Number(d.settlement) || 0, receivable,
      revenue: receivable, cost: Number(d.settlement) || 0, clicks: Number(d.traffic) || 0,
      source, status: true,
    };
    const existing = getAll(COLLECTION).find((r) => r.date === date && (r.adIdId === ad.id || r.objectId === ad.name));
    if (existing) update(COLLECTION, existing.id, payload);
    else create(COLLECTION, payload as Omit<Row, 'id'>);
    setSavedIds((s) => new Set(s).add(ad.id));
    toast(t('entry.savedRow'));
  };

  // AI auto-fill: simulate fetching traffic/settlement from an external source for visible rows.
  const aiFill = () => {
    setDraft((d) => {
      const next = { ...d };
      for (const ad of rows) {
        const cur = next[ad.id] || { unitPrice: ad.unitPrice ?? '', traffic: '', settlement: '' };
        next[ad.id] = {
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
  const valueCell = (ad: Row, field: 'traffic' | 'settlement') => {
    const v = draft[ad.id]?.[field];
    const isEditing = editing?.id === ad.id && editing.field === field;
    if (isEditing) {
      return (
        <input autoFocus type="number" defaultValue={v === '' || v == null ? '' : String(v)}
          onBlur={(e) => { setCell(ad.id, field, e.target.value); setEditing(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-24 h-7 px-2 rounded border border-cyan-300 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200" />
      );
    }
    if (v === '' || v == null) {
      return (
        <button disabled={!canEdit} onClick={() => setEditing({ id: ad.id, field })}
          className="h-7 px-2 rounded border border-dashed border-gray-300 text-xs text-gray-400 hover:border-cyan-300 hover:text-cyan-500 disabled:opacity-50">
          + {t('entry.value')}
        </button>
      );
    }
    return (
      <button disabled={!canEdit} onClick={() => setEditing({ id: ad.id, field })}
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
          <p className="text-sm text-gray-500 mt-0.5">{t('entry.forDate')}: <span className="font-medium text-gray-700">{date}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={sel} />
          <LatestDataHint collections={[COLLECTION]} current={date} onPick={setDate} />
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
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value as typeof fStatus)} className={sel}>
            <option value="all">{t('entry.allStatus')}</option>
            <option value="online">{t('entry.online')}</option>
            <option value="offline">{t('entry.offline')}</option>
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
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                {[t('col.date'), t('col.advertiser'), t('col.adOrder'), t('col.type'), t('col.adId'),
                  t('entry.unitShare'), t('entry.traffic'), t('entry.settlement'), t('entry.receivable'),
                  t('common.status'), t('common.actions')].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-12 text-center text-gray-400">{t('common.noData')}</td></tr>
              )}
              {rows.map((ad) => {
                const d = draft[ad.id] || { unitPrice: ad.unitPrice ?? '', traffic: '', settlement: '' };
                const price = priceOf(ad);
                const receivable = receivableOf(ad.type, { unitPrice: price, traffic: d.traffic, settlement: d.settlement });
                const isOnline = ad.status !== false;
                return (
                  <tr key={ad.id} className="border-b border-gray-50 hover:bg-cyan-50/30">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{date}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{refName('advertisers', ad.advertiserId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{refName('adOrders', ad.adOrderId)}</td>
                    <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">{ad.type}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{ad.name}</td>
                    <td className="px-3 py-2">
                      <RateEditor value={price} workingDate={date} suffix={ad.type === 'CPS' ? '%' : ''} integer={ad.type === 'CPS'} disabled={!canEdit}
                        onSet={(v, eff) => { setRate('adId', ad.id, 'unitPrice', v, eff); toast(t('entry.effSaved')); }} />
                    </td>
                    <td className="px-3 py-2">{valueCell(ad, 'traffic')}</td>
                    <td className="px-3 py-2">{valueCell(ad, 'settlement')}</td>
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
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        {canCreate || canEdit ? (
                          <button onClick={() => saveRow(ad)}
                            className="h-7 px-2.5 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600">
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
      </div>
    </div>
  );
}
