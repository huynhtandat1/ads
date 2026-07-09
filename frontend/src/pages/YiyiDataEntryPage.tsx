import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';
import { DateRangePicker } from '../components/DateRangePicker';
import { useAuth } from '../auth/AuthContext';
import { useCollection, getAll, create, update, type Row } from '../data/store';
import { round3 } from '../lib/format';
import { useDatesInRange, yesterdayStr } from '../lib/date';

const COLLECTION = 'importYiyi';
const CHANNELS = ['yy-02-01', 'yy-02-02', 'yy-02-03', 'yy-02-04'];
const money = (v: number) => '¥' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Đơn giá Yiyi là giá trên 1.000 lượt (như CPM): tiền = số lượng × giá ÷ 1000.
// Tính giữ 3 số lẻ; hiển thị money() rút về 2 số lẻ.
const yiyiMoney = (q: number, price: number) => round3((q * price) / 1000);

function emptyQty(dates: string[]): Record<string, Record<string, number | ''>> {
  return Object.fromEntries(dates.map((d) => [d, Object.fromEntries(CHANNELS.map((c) => [c, 0]))]));
}

export function YiyiDataEntryPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();
  const screen = 'g3d';
  useCollection(COLLECTION);

  const canSave = can(screen, 'create') || can(screen, 'edit');

  const [from, setFrom] = useState(yesterdayStr());
  const [to, setTo] = useState(yesterdayStr());
  // Danh sách ngày hiển thị trong khoảng [from, to].
  const datesInRange = useDatesInRange(from, to);
  // qty[date][channel] = số lượng; unitPrice/profitUnitPrice đặt chung cho cả khoảng (giống hành vi cũ).
  const [qty, setQty] = useState<Record<string, Record<string, number | ''>>>(() => emptyQty(datesInRange));
  const [unitPrice, setUnitPrice] = useState<number | ''>(0);
  const [profitUnitPrice, setProfitUnitPrice] = useState<number | ''>(0);
  const [saved, setSaved] = useState<Set<string>>(new Set()); // key = `${date}|${channel}`

  const load = () => {
    const records = getAll(COLLECTION);
    const nextQty = emptyQty(datesInRange);
    const savedSet = new Set<string>();
    let up: number | '' = 0, pup: number | '' = 0;
    // Lấy đơn giá từ ngày mới nhất có record trong khoảng (đủ dùng cho cả range).
    let latestPriceRec: Row | undefined;
    for (const d of datesInRange) {
      for (const c of CHANNELS) {
        const rec = records.find((r) => String(r.date) === d && r.objectId === c);
        nextQty[d][c] = rec?.quantity ?? 0;
        if (rec) {
          savedSet.add(`${d}|${c}`);
          if (!latestPriceRec || String(rec.date) > String(latestPriceRec.date)) latestPriceRec = rec;
        }
      }
    }
    if (latestPriceRec) {
      up = Number(latestPriceRec.unitPrice) || 0;
      pup = Number(latestPriceRec.profitUnitPrice) || 0;
    } else {
      // Kế thừa đơn giá: nếu cả range chưa có bản ghi → lấy ngày gần nhất trước `from`.
      let prev: Row | undefined;
      for (const r of records) {
        if (String(r.date) < from && (!prev || String(r.date) > String(prev.date))) prev = r;
      }
      if (prev) { up = Number(prev.unitPrice) || 0; pup = Number(prev.profitUnitPrice) || 0; }
    }
    setQty(nextQty);
    setUnitPrice(up);
    setProfitUnitPrice(pup);
    setSaved(savedSet);
  };

  useEffect(load, [from, to]);

  // Realtime totals: cộng dồn cả khoảng.
  const up = Number(unitPrice) || 0;
  const pup = Number(profitUnitPrice) || 0;
  let totalQty = 0, enteredCellCount = 0, savedCellCount = 0;
  const dayTotals: { date: string; payable: number; profit: number }[] = [];
  for (const d of datesInRange) {
    let dayQty = 0, dayPayable = 0, dayProfit = 0;
    for (const c of CHANNELS) {
      const q = Number(qty[d]?.[c]) || 0;
      dayQty += q;
      dayPayable += yiyiMoney(q, up);
      dayProfit += yiyiMoney(q, pup);
      if (q > 0) enteredCellCount++;
      if (saved.has(`${d}|${c}`)) savedCellCount++;
    }
    totalQty += dayQty;
    dayTotals.push({ date: d, payable: round3(dayPayable), profit: round3(dayProfit) });
  }
  const totalPayable = round3(dayTotals.reduce((s, d) => s + d.payable, 0));
  const totalProfit = round3(dayTotals.reduce((s, d) => s + d.profit, 0));
  const allEnteredSaved = enteredCellCount > 0 && enteredCellCount === savedCellCount;

  const save = () => {
    const records = getAll(COLLECTION);
    let written = 0;
    for (const d of datesInRange) {
      for (const c of CHANNELS) {
        const q = Number(qty[d]?.[c]) || 0;
        if (q === 0) continue; // bỏ qua ngày không có số lượng
        const payable = yiyiMoney(q, up);
        const profit = yiyiMoney(q, pup);
        const payload = {
          date: d, objectId: c, quantity: q, unitPrice: up, profitUnitPrice: pup,
          payable, profit, revenue: payable + profit, cost: payable, clicks: q,
          source: 'Yiyi', status: true,
        };
        const existing = records.find((r) => String(r.date) === d && r.objectId === c);
        if (existing) update(COLLECTION, existing.id, payload);
        else create(COLLECTION, payload as Omit<Row, 'id'>);
        written++;
      }
    }
    setSaved((s) => {
      const next = new Set(s);
      for (const d of datesInRange) for (const c of CHANNELS) if ((Number(qty[d]?.[c]) || 0) > 0) next.add(`${d}|${c}`);
      return next;
    });
    toast(written === 0 ? t('entry.savedRow') : `${t('entry.savedRow')} · ${written}`);
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
          <p className="text-sm text-gray-500 mt-0.5">{t('entry.forDate')}: <span className="font-medium text-gray-700">{from}{from !== to ? ` ~ ${to}` : ''}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        </div>
      </div>

      {/* 3 summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className={card}>
          <div className="text-sm text-gray-500">{t('col.quantity')}</div>
          <div className="text-3xl font-bold text-gray-800 mt-1">{totalQty.toLocaleString()}</div>
          <div className="text-xs text-cyan-600 mt-1">{enteredCellCount}/{CHANNELS.length * datesInRange.length} {t('entry.channels')}</div>
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
          <table className="w-full text-sm [&_th]:text-center [&_td]:text-center">
            <thead>
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wide">{t('col.date')}</th>
                <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wide">{t('entry.channel')}</th>
                <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wide w-48">{t('col.quantity')}</th>
                <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wide text-center">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {datesInRange.flatMap((d) => CHANNELS.map((c) => {
                const q = Number(qty[d]?.[c]) || 0;
                const entered = q > 0;
                const isSaved = saved.has(`${d}|${c}`) && entered;
                return (
                  <tr key={`${d}|${c}`} className="border-b border-gray-50">
                    <td className="px-4 py-3 text-gray-600">{d}</td>
                    <td className="px-4 py-3 font-medium text-gray-700 font-mono">{c}</td>
                    <td className="px-4 py-3">
                      <input type="number" min={0} disabled={!canSave}
                        value={qty[d]?.[c] === '' || qty[d]?.[c] == null ? '' : String(qty[d][c])}
                        onChange={(e) => {
                          const v = e.target.value === '' ? '' : Number(e.target.value);
                          setQty((s) => ({ ...s, [d]: { ...(s[d] || {}), [c]: v } }));
                          setSaved((s) => { const next = new Set(s); next.delete(`${d}|${c}`); return next; });
                        }}
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
              }))}
            </tbody>
          </table>
        </div>

        {/* Right: price card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 h-fit">
          <h3 className="font-bold text-gray-800 mb-4">{t('entry.priceCard')}</h3>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5 tracking-wide">{t('report.unitPriceShort')}</label>
          <input type="number" step="0.01" disabled={!canSave} value={unitPrice === '' ? '' : String(unitPrice)}
            onChange={(e) => setUnitPrice(e.target.value === '' ? '' : Number(e.target.value))} className={`${inp} mb-4`} />
          <label className="block text-xs font-semibold text-gray-500 mb-1.5 tracking-wide">{t('report.profitUnitPrice')}</label>
          <input type="number" step="0.01" disabled={!canSave} value={profitUnitPrice === '' ? '' : String(profitUnitPrice)}
            onChange={(e) => setProfitUnitPrice(e.target.value === '' ? '' : Number(e.target.value))} className={inp} />
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end mt-5">
        <button onClick={save} disabled={!canSave}
          className={`h-10 px-6 rounded-lg text-sm font-semibold disabled:opacity-50 ${allEnteredSaved ? 'bg-gray-100 text-emerald-700' : 'bg-cyan-500 text-white hover:bg-cyan-600'}`}>
          {allEnteredSaved ? t('entry.savedShort') : t('entry.saveRow')}
        </button>
      </div>
    </div>
  );
}
