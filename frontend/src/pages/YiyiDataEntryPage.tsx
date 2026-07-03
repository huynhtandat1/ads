import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { useCollection, getAll, create, update, type Row } from '../data/store';

import { yesterdayStr } from '../lib/date';

const COLLECTION = 'importYiyi';
const CHANNELS = ['yy-02-01', 'yy-02-02', 'yy-02-03', 'yy-02-04'];
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function YiyiDataEntryPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();
  const screen = 'g3d';
  useCollection(COLLECTION);

  const canSave = can(screen, 'create') || can(screen, 'edit');

  const [date, setDate] = useState(yesterdayStr());
  const [qty, setQty] = useState<Record<string, number | ''>>(() => Object.fromEntries(CHANNELS.map((c) => [c, 0])));
  const [unitPrice, setUnitPrice] = useState<number | ''>(0);
  const [profitUnitPrice, setProfitUnitPrice] = useState<number | ''>(0);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const load = () => {
    const records = getAll(COLLECTION);
    const nextQty: Record<string, number | ''> = {};
    const savedSet = new Set<string>();
    let up: number | '' = 0, pup: number | '' = 0;
    for (const c of CHANNELS) {
      const rec = records.find((r) => r.date === date && r.objectId === c);
      nextQty[c] = rec?.quantity ?? 0;
      if (rec) { savedSet.add(c); up = rec.unitPrice ?? up; pup = rec.profitUnitPrice ?? pup; }
    }
    setQty(nextQty);
    setUnitPrice(up);
    setProfitUnitPrice(pup);
    setSaved(savedSet);
  };

  useEffect(load, [date]);

  // Realtime totals
  const up = Number(unitPrice) || 0;
  const pup = Number(profitUnitPrice) || 0;
  const totalQty = CHANNELS.reduce((s, c) => s + (Number(qty[c]) || 0), 0);
  const enteredCount = CHANNELS.filter((c) => (Number(qty[c]) || 0) > 0).length;
  const totalPayable = CHANNELS.reduce((s, c) => s + (Number(qty[c]) || 0) * up, 0);
  const totalProfit = CHANNELS.reduce((s, c) => s + (Number(qty[c]) || 0) * pup, 0);

  const save = () => {
    const records = getAll(COLLECTION);
    for (const c of CHANNELS) {
      const q = Number(qty[c]) || 0;
      const payable = q * up;
      const profit = q * pup;
      const payload = {
        date, objectId: c, quantity: q, unitPrice: up, profitUnitPrice: pup,
        payable, profit, revenue: payable + profit, cost: payable, clicks: q,
        source: 'Yiyi', status: true,
      };
      const existing = records.find((r) => r.date === date && r.objectId === c);
      if (existing) update(COLLECTION, existing.id, payload);
      else create(COLLECTION, payload as Omit<Row, 'id'>);
    }
    setSaved(new Set(CHANNELS));
    toast(t('entry.savedRow'));
  };

  const card = "rounded-xl border border-cyan-100 bg-gradient-to-br from-cyan-50 to-sky-50 p-5";
  const inp = "w-full h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200 disabled:bg-gray-50";

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <div className="text-xs font-semibold tracking-widest text-cyan-500">{t('entry.eyebrow')}</div>
          <h1 className="text-xl font-bold text-gray-800">{t('menu.g3d')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('entry.forDate')}: <span className="font-medium text-gray-700">{date}</span></p>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white" />
      </div>

      {/* 3 summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className={card}>
          <div className="text-sm text-gray-500">{t('col.quantity')}</div>
          <div className="text-3xl font-bold text-gray-800 mt-1">{totalQty.toLocaleString()}</div>
          <div className="text-xs text-cyan-600 mt-1">{enteredCount}/4 {t('entry.channels')}</div>
        </div>
        <div className={card}>
          <div className="text-sm text-gray-500">{t('entry.payable')}</div>
          <div className="text-3xl font-bold text-orange-600 mt-1">{money(totalPayable)}</div>
          <div className="text-xs text-gray-500 mt-1">{t('entry.totalPayable')}</div>
        </div>
        <div className={card}>
          <div className="text-sm text-gray-500">{t('col.profit')}</div>
          <div className="text-3xl font-bold text-emerald-600 mt-1">{money(totalProfit)}</div>
          <div className="text-xs text-gray-500 mt-1">{t('entry.profitEst')}</div>
        </div>
      </div>

      {/* Entry block */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: 4 channels */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wide">{t('entry.channel')}</th>
                <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wide w-48">{t('col.quantity')}</th>
                <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wide text-center">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {CHANNELS.map((c) => {
                const entered = (Number(qty[c]) || 0) > 0;
                const isSaved = saved.has(c) && entered;
                return (
                  <tr key={c} className="border-b border-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-700 font-mono">{c}</td>
                    <td className="px-4 py-3">
                      <input type="number" min={0} disabled={!canSave}
                        value={qty[c] === '' ? '' : String(qty[c])}
                        onChange={(e) => setQty((s) => ({ ...s, [c]: e.target.value === '' ? '' : Number(e.target.value) }))}
                        className={inp} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        isSaved ? 'bg-emerald-100 text-emerald-700'
                        : entered ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        : 'bg-gray-100 text-gray-400'}`}>
                        {isSaved ? `✓ ${t('entry.confirmed')}` : entered ? t('entry.confirm') : t('entry.notEntered')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Right: price card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 h-fit">
          <h3 className="font-bold text-gray-800 mb-4">{t('entry.priceCard')}</h3>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5 tracking-wide">UNITPRICE</label>
          <input type="number" step="0.01" disabled={!canSave} value={unitPrice === '' ? '' : String(unitPrice)}
            onChange={(e) => setUnitPrice(e.target.value === '' ? '' : Number(e.target.value))} className={`${inp} mb-4`} />
          <label className="block text-xs font-semibold text-gray-500 mb-1.5 tracking-wide">PROFITUNITPRICE</label>
          <input type="number" step="0.01" disabled={!canSave} value={profitUnitPrice === '' ? '' : String(profitUnitPrice)}
            onChange={(e) => setProfitUnitPrice(e.target.value === '' ? '' : Number(e.target.value))} className={inp} />
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end mt-5">
        <button onClick={save} disabled={!canSave}
          className="h-10 px-6 rounded-lg bg-cyan-500 text-white text-sm font-semibold hover:bg-cyan-600 disabled:opacity-50">
          {t('entry.saveRow')}
        </button>
      </div>
    </div>
  );
}
