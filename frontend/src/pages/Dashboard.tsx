import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollection } from '../data/store';
import { sumPerf, allPerf, filterByDate } from '../lib/analytics';
import { money } from '../lib/format';
import { DateRangePicker } from '../components/DateRangePicker';
import { useAuth } from '../auth/AuthContext';
import { defaultDateRange } from '../lib/date';

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent || 'text-gray-800'}`}>{value}</div>
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [defaultFrom, defaultTo] = defaultDateRange();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  useCollection('importAI');
  useCollection('importAdv');
  useCollection('importMedia');
  const advN = useCollection('advertisers').length;
  const medN = useCollection('media').length;
  const midN = useCollection('mediaIds').length;
  const tot = sumPerf(filterByDate(allPerf(), from, to));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">{t('common.welcome')}, {user?.fullName || user?.username}</h1>
          <p className="text-sm text-gray-500 mt-1">KrakenOcean · {t('common.loginSub')}</p>
          <p className="text-xs text-gray-400 mt-1">{from} ~ {to}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Stat label={t('report.totalRevenue')} value={money(tot.revenue)} accent="text-cyan-600" />
        <Stat label={t('report.totalCost')} value={money(tot.cost)} accent="text-orange-500" />
        <Stat label={t('report.totalProfit')} value={money(tot.profit)} accent="text-emerald-600" />
        <Stat label={t('report.avgMargin')} value={tot.margin + '%'} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t('menu.g1a')} value={String(advN)} />
        <Stat label={t('menu.g2a')} value={String(medN)} />
        <Stat label={t('menu.g2c')} value={String(midN)} />
        <Stat label={t('report.records')} value={String(tot.records)} />
      </div>
    </div>
  );
}
