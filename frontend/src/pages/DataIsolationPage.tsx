import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type Column } from '../components/DataTable';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { useCollection, getAll, update, restoreQuarantine, purgeQuarantine, type Row } from '../data/store';
import { IconRefresh, IconTrash } from '../components/icons';
import { sortByGroupedLabel } from '../lib/optionSort';

// collection id -> tên hiển thị (theo menu)
const COLLECTION_LABEL: Record<string, string> = {
  advertisers: 'menu.g1a', adOrders: 'menu.g1b', adIds: 'menu.g1c',
  media: 'menu.g2a', mediaOrders: 'menu.g2b', mediaIds: 'menu.g2c',
  importAI: 'menu.g3a', importAdv: 'menu.g3b', importMedia: 'menu.g3c',
  settleAdv: 'menu.g5a', settleMedia: 'menu.g5b', users: 'menu.g7a', roles: 'menu.g7b',
};

export function DataIsolationPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();
  const [tab, setTab] = useState<'scope' | 'bin'>('bin');
  const users = useCollection('users');
  const quarantined = useCollection('quarantine');
  useCollection('advertisers');

  const canEdit = can('g7c', 'edit');
  const canPurge = can('g7c', 'delete');
  const advOptions = sortByGroupedLabel(getAll('advertisers'), (r) => r.name);

  const setScope = (u: Row, scope: string) => { update('users', u.id, { scope }); toast(t('common.saved')); };

  const scopeCols: Column[] = [
    { key: '_stt', label: t('col.stt'), type: 'index' },
    { key: 'username', label: t('col.username'), sortable: true },
    { key: 'fullName', label: t('col.fullName') },
    { key: 'role', label: t('col.roleName'), type: 'badge' },
    {
      key: 'scope', label: t('iso.tabScope'),
      render: (u) => (
        <select value={u.scope || 'all'} disabled={!canEdit} onChange={(e) => setScope(u, e.target.value)}
          className="h-8 px-2 rounded-lg border border-gray-200 text-sm bg-white disabled:opacity-60">
          <option value="all">{t('common.all')}</option>
          {advOptions.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
        </select>
      ),
      exportValue: (u) => (u.scope && u.scope !== 'all' ? `adv:${u.scope}` : 'all'),
    },
  ];

  const binCols: Column[] = [
    { key: '_stt', label: t('col.stt'), type: 'index' },
    { key: 'label', label: t('iso.name'), sortable: true },
    {
      key: 'collection', label: t('iso.origin'), sortable: true,
      render: (q) => <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">{COLLECTION_LABEL[q.collection] ? t(COLLECTION_LABEL[q.collection]) : q.collection}</span>,
      exportValue: (q) => q.collection,
    },
    { key: 'time', label: t('iso.time'), sortable: true },
    { key: 'user', label: t('iso.by') },
    {
      key: 'actions', label: t('common.actions'), align: 'center',
      render: (q) => (
        <div className="flex items-center justify-center gap-1.5">
          {canEdit && (
            <button onClick={() => { restoreQuarantine(q.id); toast(t('iso.restored')); }}
              className="h-7 px-2 inline-flex items-center gap-1 rounded-lg bg-emerald-50 text-emerald-600 text-xs font-medium hover:bg-emerald-100">
              <IconRefresh width={14} height={14} /> {t('iso.restore')}
            </button>
          )}
          {canPurge && (
            <button onClick={() => { if (confirm(t('iso.confirmPurge'))) { purgeQuarantine(q.id); toast(t('iso.purged')); } }}
              className="h-7 px-2 inline-flex items-center gap-1 rounded-lg bg-rose-50 text-rose-600 text-xs font-medium hover:bg-rose-100">
              <IconTrash width={14} height={14} /> {t('iso.purge')}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-3">{t('menu.g7c')}</h1>

      <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden mb-4">
        <button onClick={() => setTab('bin')}
          className={`px-4 h-9 text-sm ${tab === 'bin' ? 'bg-cyan-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
          {t('iso.tabBin')} {quarantined.length ? `(${quarantined.length})` : ''}
        </button>
        <button onClick={() => setTab('scope')}
          className={`px-4 h-9 text-sm ${tab === 'scope' ? 'bg-cyan-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
          {t('iso.tabScope')}
        </button>
      </div>

      {tab === 'scope'
        ? <DataTable columns={scopeCols} rows={users} exportName="data_scope" canExport={can('g7c', 'export')} />
        : <DataTable columns={binCols} rows={quarantined} exportName="quarantine" canExport={can('g7c', 'export')} />}
    </div>
  );
}
