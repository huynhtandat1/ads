import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Row } from '../data/store';
import { Toggle } from './Toggle';
import { IconSearch, IconDownload, IconFilter } from './icons';
import { exportCSV } from '../lib/export';
import { formatId } from '../lib/format';

export interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  type?: 'index' | 'id' | 'text' | 'tags' | 'toggle' | 'currency' | 'percent' | 'number' | 'badge';
  render?: (row: Row, absoluteIndex: number) => ReactNode;
  exportValue?: (row: Row) => string | number;
  align?: 'left' | 'center' | 'right';
}

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

interface Props {
  columns: Column[];
  rows: Row[];
  toolbarLeft?: ReactNode;
  filters?: FilterDef[];
  searchKeys?: string[];
  onToggle?: (row: Row) => void;
  canExport?: boolean;
  exportName?: string;
  pageSize?: number;
}

const money = (v: number) => '¥' + Number(v || 0).toLocaleString();

// Filterable text of a cell (reuses exportValue for ref/computed columns).
function cellText(col: Column, r: Row): string {
  if (col.exportValue) return String(col.exportValue(r));
  if (col.type === 'id') return formatId(r[col.key]);
  const v = r[col.key];
  if (Array.isArray(v)) return v.join(', ');
  return String(v ?? '');
}
// Columns that cannot be sorted / filtered.
const noSort = (c: Column) => c.type === 'index' || c.key === 'actions';
const noFilter = (c: Column) => c.type === 'index' || c.key === 'actions';

export function DataTable({
  columns, rows, toolbarLeft, filters = [], searchKeys, onToggle,
  canExport = true, exportName = 'export', pageSize = 10,
}: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [filterVals, setFilterVals] = useState<Record<string, string>>({});
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let data = [...rows];
    for (const f of filters) {
      const v = filterVals[f.key];
      if (v && v !== 'all') data = data.filter((r) => String(r[f.key]) === v);
    }
    // Bộ lọc theo từng cột (chọn giá trị có sẵn)
    for (const c of columns) {
      const fv = colFilters[c.key];
      if (!fv) continue;
      if (c.type === 'toggle') data = data.filter((r) => (r[c.key] ? 'on' : 'off') === fv);
      else data = data.filter((r) => cellText(c, r) === fv);
    }
    if (q.trim()) {
      const keys = searchKeys ?? columns.filter((c) => !['index', 'toggle'].includes(c.type || '')).map((c) => c.key);
      const idKeys = new Set(columns.filter((c) => c.type === 'id').map((c) => c.key));
      const lc = q.toLowerCase();
      data = data.filter((r) => keys.some((k) => {
        if (idKeys.has(k)) return formatId(r[k]).toLowerCase().includes(lc);
        return String(r[k] ?? '').toLowerCase().includes(lc);
      }));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      data.sort((a, b) => {
        if (col && ['currency', 'percent', 'number'].includes(col.type || '')) {
          return ((Number(a[sort.key]) || 0) - (Number(b[sort.key]) || 0)) * sort.dir;
        }
        const av = col ? cellText(col, a) : String(a[sort.key] ?? '');
        const bv = col ? cellText(col, b) : String(b[sort.key] ?? '');
        const na = Number(av), nb = Number(bv);
        if (av !== '' && bv !== '' && !isNaN(na) && !isNaN(nb)) return (na - nb) * sort.dir;
        return av.localeCompare(bv) * sort.dir;
      });
    }
    return data;
  }, [rows, filters, filterVals, colFilters, q, sort, columns, searchKeys]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((curPage - 1) * pageSize, curPage * pageSize);

  // ID columns are hidden from the UI (still available in CSV export).
  const visibleColumns = columns.filter((c) => c.type !== 'id');

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  };

  // Giá trị có sẵn của một cột (để chọn trong bộ lọc).
  const distinctValues = (c: Column): string[] => {
    const set = new Set<string>();
    for (const r of rows) { const v = cellText(c, r); if (v) set.add(v); }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  };

  const doExport = () => {
    const cols = columns.filter((c) => !['index', 'toggle'].includes(c.type || '') && c.key !== 'actions');
    const headers = ['STT', ...cols.map((c) => c.label)];
    const data = filtered.map((r, i) => [
      i + 1,
      ...cols.map((c) => {
        if (c.exportValue) return c.exportValue(r);
        if (c.type === 'id') return formatId(r[c.key]);
        const v = r[c.key];
        if (Array.isArray(v)) return v.join(', ');
        if (c.type === 'toggle') return v ? t('common.on') : t('common.off');
        return v ?? '-';
      }),
    ]);
    exportCSV(exportName, headers, data);
  };

  const renderCell = (col: Column, row: Row, absIdx: number): ReactNode => {
    if (col.render) return col.render(row, absIdx);
    if (col.type === 'index') return <span className="text-gray-400">{absIdx + 1}</span>;
    if (col.type === 'id') return <span className="font-mono text-gray-500">{formatId(row[col.key])}</span>;
    if (col.type === 'toggle')
      return <Toggle on={!!row[col.key]} onChange={onToggle ? () => onToggle(row) : undefined} disabled={!onToggle} />;
    const v = row[col.key];
    if (v == null || v === '') return <span className="text-gray-300">-</span>;
    if (col.type === 'tags') {
      const arr = Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean);
      if (!arr.length) return <span className="text-gray-300">-</span>;
      return <div className="flex flex-wrap gap-1">{arr.map((x, i) => (
        <span key={i} className="px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 text-xs border border-cyan-100">{x}</span>
      ))}</div>;
    }
    if (col.type === 'currency') return money(v);
    if (col.type === 'percent') return `${v}%`;
    if (col.type === 'badge') return <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">{v}</span>;
    return <span>{v}</span>;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-100">
        {toolbarLeft}
        <div className="flex-1" />
        {filters.map((f) => (
          <select key={f.key} value={filterVals[f.key] ?? 'all'}
            onChange={(e) => { setFilterVals((v) => ({ ...v, [f.key]: e.target.value })); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-200">
            <option value="all">{f.label}: {t('common.all')}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        <div className="relative">
          <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width={16} height={16} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t('common.searchPh')}
            className="h-9 pl-8 pr-3 rounded-lg border border-gray-200 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-cyan-200" />
        </div>
        <button onClick={() => setShowFilters((s) => !s)} title={t('common.filter')}
          className={`h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border text-sm ${
            showFilters ? 'border-cyan-300 bg-cyan-50 text-cyan-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          <IconFilter width={16} height={16} /> {t('common.filter')}
        </button>
        {canExport && (
          <button onClick={doExport}
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
            <IconDownload width={16} height={16} /> {t('common.export')}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 bg-gray-50/60 border-b border-gray-100">
              {visibleColumns.map((c) => {
                const sortable = !noSort(c);
                return (
                  <th key={c.key} onClick={() => sortable && toggleSort(c.key)}
                    className={`px-4 py-3 font-semibold uppercase text-xs tracking-wide whitespace-nowrap ${
                      sortable ? 'cursor-pointer select-none hover:text-gray-700' : ''
                    } ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}>
                    <span className={`inline-flex items-center gap-1 ${c.align === 'right' ? 'flex-row-reverse' : ''}`}>
                      {c.label}
                      {sortable && (
                        <span className="text-[9px] leading-none flex flex-col">
                          <span className={sort?.key === c.key && sort.dir === 1 ? 'text-cyan-500' : 'text-gray-300'}>▲</span>
                          <span className={sort?.key === c.key && sort.dir === -1 ? 'text-cyan-500' : 'text-gray-300'}>▼</span>
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
            {showFilters && (
              <tr className="bg-white border-b border-gray-100">
                {visibleColumns.map((c) => (
                  <th key={c.key} className="px-2 py-2 font-normal normal-case">
                    {noFilter(c) ? null : c.type === 'toggle' ? (
                      <select value={colFilters[c.key] ?? ''} onChange={(e) => { setColFilters((v) => ({ ...v, [c.key]: e.target.value })); setPage(1); }}
                        className="w-full h-7 px-1.5 rounded border border-gray-200 text-xs bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-cyan-300">
                        <option value="">{t('common.all')}</option>
                        <option value="on">{t('common.on')}</option>
                        <option value="off">{t('common.off')}</option>
                      </select>
                    ) : (
                      <select value={colFilters[c.key] ?? ''} onChange={(e) => { setColFilters((v) => ({ ...v, [c.key]: e.target.value })); setPage(1); }}
                        className="w-full h-7 px-1.5 rounded border border-gray-200 text-xs bg-white text-gray-600 font-normal tracking-normal focus:outline-none focus:ring-1 focus:ring-cyan-300">
                        <option value="">{t('common.all')}</option>
                        {distinctValues(c).map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={visibleColumns.length} className="px-4 py-12 text-center text-gray-400">{t('common.noData')}</td></tr>
            )}
            {pageRows.map((row) => {
              const absIdx = filtered.indexOf(row);
              return (
                <tr key={row.id} className="border-b border-gray-50 hover:bg-cyan-50/30 transition-colors">
                  {visibleColumns.map((c) => (
                    <td key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}>
                      {renderCell(c, row, absIdx)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between p-4 text-sm text-gray-500">
        <span>{t('common.total')} {filtered.length} {t('common.rows')}</span>
        <div className="flex items-center gap-1">
          <button disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}
            className="h-8 px-3 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹</button>
          <span className="px-3">{curPage} / {totalPages}</span>
          <button disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}
            className="h-8 px-3 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">›</button>
        </div>
      </div>
    </div>
  );
}
