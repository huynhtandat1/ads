import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAll, refName, type Row } from '../data/store';
import { receivableOf } from '../lib/billing';
import { exportCSV } from '../lib/export';
import { LatestDataHint } from '../components/LatestDataHint';
import { IconSearch, IconDownload } from '../components/icons';
import { monthRangeUntilYesterday } from '../lib/date';

const COLLECTION = 'importMedia';
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Số tiền phải thu / tỷ lệ chia / thực nhận (theo công thức màn Quản lý dữ liệu media chính),
// dùng giá trị đã lưu, fallback tính lại nếu thiếu.
function compute(r: Row) {
  const receivable = r.receivable ?? receivableOf(r.type, { unitPrice: r.unitPrice, traffic: r.traffic, settlement: r.settlement }) ?? 0;
  const shareRate = r.shareRate ?? 0;
  const coefficient = r.coefficient ?? 1;
  const actual = r.actual ?? Math.round(receivable * (shareRate / 100) * coefficient);
  return { receivable, shareRate, coefficient, actual };
}

export function MediaReportPage() {
  const { t } = useTranslation();
  const screen = 'g4d';

  const [from, setFrom] = useState(monthRangeUntilYesterday(0)[0]);
  const [to, setTo] = useState(monthRangeUntilYesterday(0)[1]);
  const [allDates, setAllDates] = useState(false);
  const [fMedia, setFMedia] = useState('');
  const [fOrder, setFOrder] = useState('');
  const [fMediaId, setFMediaId] = useState('');
  const [fType, setFType] = useState('');
  const [fStatus, setFStatus] = useState<'all' | 'confirmed' | 'unconfirmed'>('all');
  const [q, setQ] = useState('');
  const [result, setResult] = useState<Row[] | null>(null);

  const runQuery = () => {
    const lc = q.trim().toLowerCase();
    const data = getAll(COLLECTION).filter((r) => {
      if (!allDates && from && r.date < from) return false;
      if (!allDates && to && r.date > to) return false;
      if (fMedia && String(r.mediaId) !== fMedia) return false;
      if (fOrder && String(r.mediaOrderId) !== fOrder) return false;
      if (fMediaId && String(r.mediaIdId) !== fMediaId) return false;
      if (fType && r.type !== fType) return false;
      if (fStatus === 'confirmed' && !r.status) return false;
      if (fStatus === 'unconfirmed' && r.status) return false;
      if (lc) {
        const hay = `${r.objectId} ${refName('media', r.mediaId)} ${refName('mediaOrders', r.mediaOrderId)}`.toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : -1));
    setResult(data);
  };

  const pickThisMonth = () => { const [f, tt] = monthRangeUntilYesterday(0); setFrom(f); setTo(tt); setAllDates(false); };
  const pickLastMonth = () => { const [f, tt] = monthRangeUntilYesterday(-1); setFrom(f); setTo(tt); setAllDates(false); };

  const rows = result ?? [];
  const orderOptions = (() => {
    const seen = new Set<string>();
    return getAll('mediaOrders').filter((o) => {
      if (fMedia && String(o.mediaId) !== fMedia) return false;
      const key = String(o.name ?? '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();
  const mediaIdOptions = getAll('mediaIds').filter((m) =>
    (!fMedia || String(m.mediaId) === fMedia) && (!fOrder || String(m.mediaOrderId) === fOrder),
  );
  const totals = rows.reduce((s, r) => {
    const c = compute(r);
    return {
      traffic: s.traffic + (Number(r.traffic) || 0),
      settlement: s.settlement + (Number(r.settlement) || 0),
      receivable: s.receivable + c.receivable,
      actual: s.actual + c.actual,
    };
  }, { traffic: 0, settlement: 0, receivable: 0, actual: 0 });

  const HEADERS = [
    t('col.date'), t('col.media'), t('col.mediaOrder'), t('col.type'), t('col.mediaId'),
    t('entry.unitShare'), t('entry.traffic'), t('entry.settlement'), t('entry.coefficient'),
    t('entry.receivable'), t('entry.shareRate'), t('entry.actual'), t('common.status'),
  ];

  const doExport = () => {
    const data = rows.map((r) => {
      const c = compute(r);
      return [
        r.date, refName('media', r.mediaId), refName('mediaOrders', r.mediaOrderId), r.type, r.objectId,
        r.unitPrice, r.traffic, r.settlement, c.coefficient, c.receivable, `${c.shareRate}%`, c.actual,
        r.status ? t('entry.confirmed') : t('entry.unconfirmed'),
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
            <div className="flex items-center gap-1.5">
              <input type="date" value={from} disabled={allDates} onChange={(e) => setFrom(e.target.value)} className={`${sel} disabled:bg-gray-50`} />
              <span className="text-gray-400">—</span>
              <input type="date" value={to} disabled={allDates} onChange={(e) => setTo(e.target.value)} className={`${sel} disabled:bg-gray-50`} />
            </div>
          </div>
          <button onClick={pickThisMonth} className="h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">{t('report.thisMonth')}</button>
          <button onClick={pickLastMonth} className="h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">{t('report.lastMonth')}</button>
          <LatestDataHint collections={[COLLECTION]} current={to}
            onPick={(d) => { setFrom(`${d.slice(0, 7)}-01`); setTo(d); setAllDates(false); }} />
        </div>

        <div className="flex-1" />

        <div className="flex flex-wrap items-end gap-2 justify-end">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden h-9">
            <button onClick={() => setAllDates(false)} className={`px-3 text-sm ${!allDates ? 'bg-cyan-500 text-white' : 'bg-white text-gray-600'}`}>{t('report.business')}</button>
            <button onClick={() => setAllDates(true)} className={`px-3 text-sm ${allDates ? 'bg-cyan-500 text-white' : 'bg-white text-gray-600'}`}>{t('report.allDates')}</button>
          </div>
          <select value={fMedia} onChange={(e) => { setFMedia(e.target.value); setFOrder(''); setFMediaId(''); }} className={sel}>
            <option value="">{t('col.media')}</option>
            {getAll('media').map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
          </select>
          <select value={fOrder} onChange={(e) => { setFOrder(e.target.value); setFMediaId(''); }} className={sel}>
            <option value="">{t('col.mediaOrder')}</option>
            {orderOptions.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>
          <select value={fMediaId} onChange={(e) => setFMediaId(e.target.value)} className={sel}>
            <option value="">{t('col.mediaId')}</option>
            {mediaIdOptions.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
          </select>
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width={16} height={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.searchPh')}
              className="h-9 pl-8 pr-3 rounded-lg border border-gray-200 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-cyan-200" />
          </div>
          <select value={fType} onChange={(e) => setFType(e.target.value)} className={sel}>
            <option value="">{t('col.type')}</option>
            {['CPM', 'CPA', 'CPS'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value as typeof fStatus)} className={sel}>
            <option value="all">{t('report.confirmFilter')}: {t('common.all')}</option>
            <option value="confirmed">{t('entry.confirmed')}</option>
            <option value="unconfirmed">{t('entry.unconfirmed')}</option>
          </select>
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
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                {HEADERS.map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 font-semibold uppercase text-[11px] tracking-wide whitespace-nowrap ${i >= 5 && i <= 11 ? 'text-right' : ''}`}>{h}</th>
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
                  {/* Grand total */}
                  <tr className="bg-brand-dark2 text-white font-semibold">
                    <td className="px-3 py-2" colSpan={6}>Σ {t('report.grandTotal')} · {rows.length} {t('report.records')}</td>
                    <td className="px-3 py-2 text-right">{totals.traffic.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{money(totals.settlement)}</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right">{money(totals.receivable)}</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right text-cyan-300">{money(totals.actual)}</td>
                    <td className="px-3 py-2" />
                  </tr>
                  {rows.map((r) => {
                    const c = compute(r);
                    return (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-cyan-50/30">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{r.date}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{refName('media', r.mediaId)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{refName('mediaOrders', r.mediaOrderId)}</td>
                        <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">{r.type}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{r.objectId}</td>
                        <td className="px-3 py-2 text-right">{r.unitPrice}</td>
                        <td className="px-3 py-2 text-right">{Number(r.traffic).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{money(r.settlement)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{c.coefficient}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-700">{money(c.receivable)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{c.shareRate}%</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-600">{money(c.actual)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.status ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            {r.status ? `✓ ${t('entry.confirmed')}` : t('entry.unconfirmed')}
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
