import { useTranslation } from 'react-i18next';
import { DataTable, type Column, type FilterDef } from '../components/DataTable';
import { useAuth } from '../auth/AuthContext';
import { useCollection } from '../data/store';

const ACTION_COLOR: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700',
  edit: 'bg-amber-100 text-amber-700',
  delete: 'bg-rose-100 text-rose-700',
  login: 'bg-cyan-100 text-cyan-700',
  export: 'bg-violet-100 text-violet-700',
};

export function LogsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const rows = useCollection('logs');

  const columns: Column[] = [
    { key: '_stt', label: t('col.stt'), type: 'index' },
    { key: 'time', label: t('col.time'), sortable: true },
    { key: 'user', label: t('col.user'), sortable: true },
    {
      key: 'action', label: t('col.action'), align: 'center',
      render: (r) => <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLOR[r.action] || 'bg-gray-100 text-gray-600'}`}>{r.action}</span>,
    },
    { key: 'object', label: t('col.object') },
    { key: 'ip', label: t('col.ip') },
    { key: 'detail', label: t('col.detail') },
  ];

  const filters: FilterDef[] = [{
    key: 'action', label: t('col.action'),
    options: ['create', 'edit', 'delete', 'login', 'export'].map((a) => ({ value: a, label: a })),
  }];

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-4">{t('menu.g6')}</h1>
      <DataTable columns={columns} rows={rows} filters={filters} exportName="operation_logs"
        canExport={can('g6', 'export')} />
    </div>
  );
}
