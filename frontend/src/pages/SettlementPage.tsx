import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type Column } from '../components/DataTable';
import { FormModal, type FieldDef } from '../components/FormModal';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { useCollection, getAll, create, update, type Row } from '../data/store';
import { api } from '../api';
import { IconPlus, IconPencil, IconEye } from '../components/icons';

interface Props { screen: string; collection: string; titleKey: string; targetFrom: string; previewType: 'adv' | 'media' }

const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStart = () => todayStr().slice(0, 8) + '01';

export function SettlementPage({ screen, collection, titleKey, targetFrom, previewType }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();
  const rows = useCollection(collection);
  const [editing, setEditing] = useState<Row | null | undefined>(undefined); // FormModal (edit)
  const [gen, setGen] = useState(false); // generate modal

  const canCreate = can(screen, 'create');
  const canEdit = can(screen, 'edit');

  const togglePay = (r: Row) => {
    if (!canEdit) return;
    update(collection, r.id, { payStatus: r.payStatus === 'paid' ? 'unpaid' : 'paid' });
    toast(t('common.toggled'));
  };

  const columns: Column[] = [
    { key: '_stt', label: t('col.stt'), type: 'index' },
    { key: 'id', label: t('col.id'), type: 'id', sortable: true },
    { key: 'code', label: t('col.code'), sortable: true },
    { key: 'target', label: t('col.target'), sortable: true },
    { key: 'period', label: t('col.period') },
    { key: 'totalAmount', label: t('col.totalAmount'), type: 'currency', align: 'right', sortable: true },
    {
      key: 'payStatus', label: t('col.payStatus'), align: 'center',
      render: (r) => (
        <button onClick={() => togglePay(r)} disabled={!canEdit}
          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
            r.payStatus === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          } ${canEdit ? 'hover:opacity-80 cursor-pointer' : ''}`}>
          {r.payStatus === 'paid' ? t('pay.paid') : t('pay.unpaid')}
        </button>
      ),
      exportValue: (r) => (r.payStatus === 'paid' ? t('pay.paid') : t('pay.unpaid')),
    },
    { key: 'createdAt', label: t('col.createdAt'), sortable: true },
    {
      key: 'actions', label: t('common.actions'), align: 'center',
      render: (r) => (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => alert(`${r.code}\n${r.target}\n${r.period}\n¥${Number(r.totalAmount).toLocaleString()}`)}
            className="p-1.5 rounded-lg text-cyan-600 hover:bg-cyan-50"><IconEye width={16} height={16} /></button>
          {canEdit && <button onClick={() => setEditing(r)} className="p-1.5 rounded-lg text-orange-500 hover:bg-orange-50"><IconPencil width={16} height={16} /></button>}
        </div>
      ),
    },
  ];

  // Edit form (manual)
  const fields: FieldDef[] = [
    { key: 'code', label: t('col.code'), type: 'text', required: true },
    { key: 'target', label: t('col.target'), type: 'select', required: true, optionsFrom: targetFrom, optionValue: 'name', optionLabel: 'name' },
    { key: 'period', label: t('col.period'), type: 'text', required: true, hint: '2026-06-01 ~ 2026-06-15' },
    { key: 'totalAmount', label: t('col.totalAmount'), type: 'number', required: true, default: 0 },
    { key: 'payStatus', label: t('col.payStatus'), type: 'select', required: true, default: 'unpaid',
      options: [{ value: 'unpaid', label: t('pay.unpaid') }, { value: 'paid', label: t('pay.paid') }] },
    { key: 'createdAt', label: t('col.createdAt'), type: 'text', default: todayStr() },
  ];

  const onEditSubmit = (vals: Record<string, unknown>) => {
    if (editing) update(collection, editing.id, vals);
    setEditing(undefined);
    toast(t('common.saved'));
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-4">{t(titleKey)}</h1>
      <DataTable columns={columns} rows={rows} exportName={collection} canExport={can(screen, 'export')}
        toolbarLeft={canCreate && (
          <button onClick={() => setGen(true)}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600">
            <IconPlus width={16} height={16} /> {t('settle.generate')}
          </button>
        )} />

      {editing !== undefined && editing && (
        <FormModal title={t('common.editItem')} fields={fields}
          initial={editing} onClose={() => setEditing(undefined)} onSubmit={onEditSubmit} />
      )}

      {gen && (
        <GenerateModal
          collection={collection} targetFrom={targetFrom} previewType={previewType}
          onClose={() => setGen(false)}
          onDone={() => { setGen(false); toast(t('common.saved')); }}
        />
      )}
    </div>
  );
}

// ---- Auto-aggregate settlement from backend totals ----
function GenerateModal({ collection, targetFrom, previewType, onClose, onDone }: {
  collection: string; targetFrom: string; previewType: 'adv' | 'media'; onClose: () => void; onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());
  const [payStatus, setPayStatus] = useState('unpaid');
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-compute total from the backend whenever target/period change.
  useEffect(() => {
    if (!target) { setTotal(null); return; }
    let active = true;
    setLoading(true);
    api.settlementPreview(previewType, target, from, to)
      .then((r) => { if (active) setTotal(r.total); })
      .catch(() => { if (active) setTotal(0); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [target, from, to, previewType]);

  const save = () => {
    if (!target || total == null) { toast(t('settle.pickTarget'), 'error'); return; }
    const prefix = previewType === 'media' ? 'ST-MED' : 'ST-ADV';
    const code = `${prefix}-${from.slice(2, 7).replace('-', '')}-${String(Math.floor(Math.random() * 90) + 10)}`;
    create(collection, {
      code, target, period: `${from} ~ ${to}`, totalAmount: total, payStatus,
      createdAt: todayStr(), status: true,
    } as Omit<Row, 'id'>);
    onDone();
  };

  const inp = "w-full h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-800">{t('settle.generate')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">{t('col.target')} <span className="text-rose-500">*</span></label>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className={inp}>
              <option value="">{t('common.selectPh')}</option>
              {getAll(targetFrom).map((r) => <option key={r.id} value={String(r.name)}>{r.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">{t('common.from')}</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">{t('common.to')}</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} />
            </div>
          </div>
          <div className="rounded-lg bg-cyan-50 border border-cyan-100 p-4">
            <div className="text-xs text-gray-500">{t('col.totalAmount')} · {t('settle.auto')}</div>
            <div className="text-2xl font-bold text-cyan-700 mt-1">
              {loading ? '…' : total == null ? '—' : '¥' + total.toLocaleString()}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">{t('col.payStatus')}</label>
            <select value={payStatus} onChange={(e) => setPayStatus(e.target.value)} className={inp}>
              <option value="unpaid">{t('pay.unpaid')}</option>
              <option value="paid">{t('pay.paid')}</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">{t('common.cancel')}</button>
          <button onClick={save} disabled={!target || total == null}
            className="h-9 px-4 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600 disabled:opacity-50">{t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}
