import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type Column } from '../components/DataTable';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { useCollection, update, create, type Row } from '../data/store';
import { MENU } from '../config/menu';
import { IconPencil, IconPlus } from '../components/icons';

const ACTIONS = ['view', 'create', 'edit', 'delete', 'export'] as const;
const SCREEN_IDS = MENU.flatMap((g) => g.children.map((c) => c.id));

type PermMap = Record<string, Record<string, boolean>>;

function emptyPerms(): PermMap {
  const p: PermMap = {};
  for (const s of SCREEN_IDS) p[s] = { view: false, create: false, edit: false, delete: false, export: false };
  return p;
}

export function RolesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();
  const rows = useCollection('roles');
  const [editing, setEditing] = useState<Row | null>(null);
  const [matrix, setMatrix] = useState<PermMap>(emptyPerms());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const canEdit = can('g7b', 'edit');
  const canCreate = can('g7b', 'create');

  const openEdit = (r: Row) => {
    setEditing(r);
    if (r.permissions === '*') {
      const all = emptyPerms();
      for (const s of SCREEN_IDS) all[s] = { view: true, create: true, edit: true, delete: true, export: true };
      setMatrix(all);
    } else {
      try { setMatrix({ ...emptyPerms(), ...JSON.parse(r.permissions) }); }
      catch { setMatrix(emptyPerms()); }
    }
  };

  const columns: Column[] = [
    { key: '_stt', label: t('col.stt'), type: 'index' },
    { key: 'id', label: t('col.id'), type: 'id' },
    { key: 'name', label: t('col.roleName'), type: 'badge', sortable: true },
    {
      key: 'permissions', label: t('perm.screen'), align: 'left',
      render: (r) => r.permissions === '*'
        ? <span className="text-emerald-600 text-xs font-medium">ALL ({SCREEN_IDS.length})</span>
        : <span className="text-gray-500 text-xs">{(() => { try { const p = JSON.parse(r.permissions); return Object.values(p as PermMap).filter((x) => x.view).length; } catch { return 0; } })()} {t('perm.screen')}</span>,
    },
    {
      key: 'actions', label: t('common.actions'), align: 'center',
      render: (r) => canEdit && r.permissions !== '*' ? (
        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-orange-500 hover:bg-orange-50"><IconPencil width={16} height={16} /></button>
      ) : <span className="text-gray-300 text-xs">—</span>,
    },
  ];

  const toggleCell = (screen: string, action: string) => {
    setMatrix((m) => ({ ...m, [screen]: { ...m[screen], [action]: !m[screen][action] } }));
  };

  const save = () => {
    if (!editing) return;
    // Chặn vô tình xóa hết quyền — nếu không còn screen nào có view=true thì vai trò
    // bị "khóa" khỏi mọi trang, user bị block ngay lập tức.
    const hasAnyView = Object.values(matrix).some((p) => p?.view);
    if (!hasAnyView) { toast(t('perm.noView'), 'error'); return; }
    update('roles', editing.id, { permissions: JSON.stringify(matrix) });
    toast(t('common.saved'));
    setEditing(null);
  };

  const saveNew = () => {
    const name = newName.trim().toUpperCase();
    if (!name) return;
    // Chặn trùng tên: backend trả 409 nhưng frontend toast "Đã lưu" lừa user vì create()
    // là optimistic — bản ghi hiện ra rồi mới bị rollback khi server từ chối.
    if (rows.some((r) => String(r.name).toUpperCase() === name)) {
      toast(t('common.duplicate'), 'error'); return;
    }
    create('roles', { name, permissions: JSON.stringify(emptyPerms()), status: true } as Omit<Row, 'id'>);
    toast(t('common.saved')); setCreating(false); setNewName('');
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-4">{t('menu.g7b')}</h1>
      <DataTable columns={columns} rows={rows} exportName="roles" canExport={can('g7b', 'export')}
        toolbarLeft={canCreate && (
          <button onClick={() => setCreating(true)}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600">
            <IconPlus width={16} height={16} /> {t('common.create')}
          </button>
        )} />

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreating(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{t('common.createNew')}</h3>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">{t('col.roleName')}</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm mb-4" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setCreating(false)} className="h-9 px-4 rounded-lg border border-gray-200 text-sm">{t('common.cancel')}</button>
              <button onClick={saveNew} className="h-9 px-4 rounded-lg bg-cyan-500 text-white text-sm font-medium">{t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h3 className="text-lg font-bold">{editing.name} — {t('perm.screen')}</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 text-xl">×</button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 font-semibold">{t('perm.screen')}</th>
                  {ACTIONS.map((a) => <th key={a} className="px-2 py-2.5 font-semibold text-center">{t(`perm.${a}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {SCREEN_IDS.map((s) => (
                  <tr key={s} className="border-b border-gray-50">
                    <td className="px-4 py-2 text-gray-700">{t(`menu.${s}`)}</td>
                    {ACTIONS.map((a) => (
                      <td key={a} className="px-2 py-2 text-center">
                        <input type="checkbox" checked={!!matrix[s]?.[a]} onChange={() => toggleCell(s, a)}
                          className="w-4 h-4 accent-cyan-500 cursor-pointer" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={() => setEditing(null)} className="h-9 px-4 rounded-lg border border-gray-200 text-sm">{t('common.cancel')}</button>
              <button onClick={save} className="h-9 px-4 rounded-lg bg-cyan-500 text-white text-sm font-medium">{t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
