import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type Column, type FilterDef } from '../components/DataTable';
import { FormModal, type FieldDef } from '../components/FormModal';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import {
  useCollection, getAll, create, update, remove, quarantine, hasRelatedData, toggleStatus, refName, type Row,
} from '../data/store';
import { SCREENS } from '../config/screens';
import { IconPlus, IconPencil } from '../components/icons';

export function CrudPage({ screen }: { screen: string }) {
  const cfg = SCREENS[screen];
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();
  const rows = useCollection(cfg.collection);
  const [editing, setEditing] = useState<Row | null | undefined>(undefined); // undefined = closed

  const canCreate = can(screen, 'create');
  const canEdit = can(screen, 'edit');
  const canDelete = can(screen, 'delete');
  // Ẩn nút "Xuất dữ liệu" ở nhóm Quản lý nhà quảng cáo (g1*) và Quản lý lưu lượng (g2*).
  const canExport = can(screen, 'export') && !/^g[12]/.test(screen);

  // Build DataTable columns
  const columns: Column[] = [
    { key: '_stt', label: t('col.stt'), type: 'index' },
    { key: 'id', label: t('col.id'), type: 'id', sortable: true },
    ...cfg.columns.map((c): Column => {
      if (c.ref) {
        return {
          key: c.key, label: t(c.labelKey), sortable: c.sortable, align: c.align,
          render: (r) => {
            const name = refName(c.ref!.collection, r[c.key], c.ref!.field || 'name');
            return name === '-' ? <span className="text-gray-300">-</span> : <span>{name}</span>;
          },
          exportValue: (r) => refName(c.ref!.collection, r[c.key], c.ref!.field || 'name'),
        };
      }
      if (c.compute) {
        return {
          key: c.key, label: t(c.labelKey), type: c.type, sortable: c.sortable, align: c.align,
          render: (r) => {
            const val = c.compute!(r);
            // Sắp các thẻ trong ô theo A→Z (vd 360 trước sm, rồi tới chữ Hán).
            const arr = (Array.isArray(val) ? [...val] : []).sort((a, b) => String(a).localeCompare(String(b)));
            if (c.type === 'tags') {
              if (!arr.length) return <span className="text-gray-300">-</span>;
              return <div className="flex flex-wrap gap-1">{arr.map((x, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 text-xs border border-cyan-100">{x}</span>
              ))}</div>;
            }
            return <span>{String(val ?? '-')}</span>;
          },
          exportValue: (r) => { const v = c.compute!(r); return Array.isArray(v) ? v.join(', ') : String(v ?? ''); },
        };
      }
      return { key: c.key, label: t(c.labelKey), type: c.type, sortable: c.sortable, align: c.align };
    }),
    { key: 'status', label: t('common.status'), type: 'toggle', align: 'center' },
    {
      key: 'actions', label: t('common.actions'), align: 'center',
      render: (r) => (
        <div className="flex items-center justify-center gap-2">
          {canEdit && (
            <button onClick={() => setEditing(r)} title={t('common.edit')}
              className="p-1.5 rounded-lg text-orange-500 hover:bg-orange-50"><IconPencil width={16} height={16} /></button>
          )}
        </div>
      ),
    },
  ];

  const filters: FilterDef[] = (cfg.filters || []).map((f) => ({
    key: f.key,
    label: t(f.labelKey),
    options: f.from
      ? getAll(f.from).map((r) => ({ value: String(r.id), label: String(r.name) }))
      : (f.static || []).map((s) => ({ value: s.value, label: t(s.labelKey) })),
  }));

  const baseFields: FieldDef[] = cfg.fields.map((f) => ({
    key: f.key, label: t(f.labelKey), type: f.type, required: f.required,
    optionsFrom: f.optionsFrom, optionLabel: f.optionLabel, optionValue: f.optionValue,
    filterBy: f.filterBy, default: f.default, step: f.step, derive: f.derive, hidden: f.hidden,
    digitsOnly: f.digitsOnly, sortActiveOptions: f.sortActiveOptions, usedOnce: f.usedOnce,
    hint: f.hintKey ? t(f.hintKey) : undefined,
    placeholder: f.placeholderKey ? t(f.placeholderKey) : undefined,
    options: f.options?.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    labelMap: f.dynLabel
      ? { watch: f.dynLabel.watch, default: t(f.dynLabel.default),
          options: Object.fromEntries(Object.entries(f.dynLabel.map).map(([k, v]) => [k, t(v)])) }
      : undefined,
  }));

  const statusField: FieldDef = { key: 'status', label: t('common.status'), type: 'toggle', default: true };
  // Trạng thái nằm ngang hàng với Đơn giá/Tỷ lệ (nếu màn có unitPrice).
  const upIdx = baseFields.findIndex((f) => f.key === 'unitPrice');
  let fields: FieldDef[];
  if (upIdx >= 0) {
    baseFields[upIdx] = { ...baseFields[upIdx], half: true };
    fields = [...baseFields];
    fields.splice(upIdx + 1, 0, { ...statusField, half: true });
  } else {
    fields = [...baseFields, statusField];
  }

  const onDelete = (r: Row) => {
    // Spec: có dữ liệu liên quan → cô lập (ẩn); không có → xóa vĩnh viễn.
    const related = hasRelatedData(cfg.collection, r.id);
    if (!confirm(related ? t('iso.confirmQuarantine') : t('common.confirmDelete'))) return;
    if (related) { quarantine(cfg.collection, r.id); toast(t('iso.quarantined')); }
    else { remove(cfg.collection, r.id); toast(t('common.deleted')); }
    setEditing(undefined);
  };

  const onSubmit = (vals: Record<string, unknown>) => {
    // Kiểm tra trùng tổ hợp duy nhất (vd: tên nhà QC, hoặc cặp nhà QC + đơn QC), bỏ qua bản ghi đang sửa.
    if (cfg.uniqueKeys) {
      const norm = (r: Record<string, unknown>) => cfg.uniqueKeys!.map((k) => String(r[k] ?? '').trim().toLowerCase()).join('\u0000');
      const key = norm(vals);
      const dup = getAll(cfg.collection).some((r) => r.id !== editing?.id && norm(r) === key);
      if (dup) { toast(t('common.duplicate'), 'error'); return; }
    }
    if (editing) update(cfg.collection, editing.id, vals);
    else create(cfg.collection, { status: true, ...vals } as Omit<Row, 'id'>); // trạng thái bật sẵn khi tạo
    setEditing(undefined);
    toast(t('common.saved'));
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-4">{t(cfg.titleKey)}</h1>
      <DataTable
        columns={columns}
        rows={rows}
        filters={filters}
        filterKeys={cfg.filterKeys}
        exportName={cfg.collection}
        canExport={canExport}
        onToggle={canEdit ? (r) => { toggleStatus(cfg.collection, r.id); toast(t('common.toggled')); } : undefined}
        toolbarLeft={canCreate && (
          <button onClick={() => setEditing(null)}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600">
            <IconPlus width={16} height={16} /> {t('common.create')}
          </button>
        )}
      />
      {editing !== undefined && (
        <FormModal
          title={editing ? t('common.editItem') : t('common.createNew')}
          fields={fields}
          // Khi sửa user: che password (không hiện hash). Để trống = giữ nguyên.
          initial={editing ? (cfg.collection === 'users' ? { ...editing, password: '' } : editing) : null}
          onClose={() => setEditing(undefined)}
          onSubmit={onSubmit}
          onDelete={editing && canDelete ? () => onDelete(editing) : undefined}
        />
      )}
    </div>
  );
}
