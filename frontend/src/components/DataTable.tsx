import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Row } from '../data/store';
import { DEFAULT_PAGE_SIZE, Pager } from './Pager';
import { Toggle } from './Toggle';
import { IconSearch, IconDownload, IconFilter } from './icons';
import { exportCSV } from '../lib/export';
import { formatId } from '../lib/format';
import { compareGroupedLabels, sortByGroupedLabel } from '../lib/optionSort';

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
  filterKeys?: string[]; // giới hạn cột nào có dropdown lọc; bỏ trống = tất cả
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

function cellValues(col: Column, r: Row): string[] {
  const text = cellText(col, r).trim();
  if (!text) return [];
  if (col.type !== 'tags') return [text];
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}
// Columns that cannot be sorted / filtered.
const noSort = (c: Column) => c.sortable !== true || c.type === 'index' || c.key === 'actions';
const noFilter = (c: Column) => c.type === 'index' || c.key === 'actions';

export function DataTable({
  columns, rows, toolbarLeft, filters = [], searchKeys, onToggle,
  canExport = true, exportName = 'export', pageSize = DEFAULT_PAGE_SIZE, filterKeys,
}: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [filterVals, setFilterVals] = useState<Record<string, string>>({});
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize); // mặc định 30; chọn 30/50/100 ở footer

  const applyActiveFilters = (source: Row[], skip: { toolbarKey?: string; columnKey?: string } = {}) => {
    let data = [...source];
    for (const f of filters) {
      if (f.key === skip.toolbarKey) continue;
      const v = filterVals[f.key];
      if (v && v !== 'all') data = data.filter((r) => String(r[f.key]) === v);
    }
    // Bộ lọc theo từng cột (chọn giá trị có sẵn)
    for (const c of columns) {
      if (c.key === skip.columnKey) continue;
      const fv = colFilters[c.key];
      if (!fv) continue;
      if (c.type === 'toggle') data = data.filter((r) => (r[c.key] ? 'on' : 'off') === fv);
      else data = data.filter((r) => cellValues(c, r).includes(fv));
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
    return data;
  };

  // So sánh 2 ô của một cột theo hướng dir (1: tăng, -1: giảm).
  const cmpCol = (col: Column, a: Row, b: Row, dir: 1 | -1): number => {
    if (['currency', 'percent', 'number'].includes(col.type || '')) {
      return ((Number(a[col.key]) || 0) - (Number(b[col.key]) || 0)) * dir;
    }
    const av = cellText(col, a), bv = cellText(col, b);
    const na = Number(av), nb = Number(bv);
    if (av !== '' && bv !== '' && !isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
    return av.localeCompare(bv) * dir;
  };

  const filtered = useMemo(() => {
    const data = applyActiveFilters(rows);
    if (sort) {
      // Người dùng bấm tiêu đề → tôn trọng sắp xếp thủ công theo cột đó.
      const col = columns.find((c) => c.key === sort.key);
      data.sort((a, b) => (col
        ? cmpCol(col, a, b, sort.dir)
        : String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? '')) * sort.dir));
    } else {
      // Không sắp thủ công: nếu có bộ lọc đang bật, tự sắp xếp theo CÁC CỘT CÒN LẠI
      // (trái→phải, A→Z, nhiều cấp) — bỏ qua chính cột đang được lọc.
      const activeKeys = new Set<string>([
        ...filters.filter((f) => { const v = filterVals[f.key]; return v && v !== 'all'; }).map((f) => f.key),
        ...Object.entries(colFilters).filter(([, v]) => v).map(([k]) => k),
      ]);
      if (activeKeys.size > 0) {
        const sortCols = columns.filter((c) =>
          !['index', 'id', 'toggle'].includes(c.type || '') && c.key !== 'actions' && !activeKeys.has(c.key));
        if (sortCols.length) {
          data.sort((a, b) => {
            for (const col of sortCols) { const r = cmpCol(col, a, b, 1); if (r !== 0) return r; }
            return 0;
          });
        }
      }
    }
    return data;
  }, [rows, filters, filterVals, colFilters, q, sort, columns, searchKeys]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / size));
  const curPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((curPage - 1) * size, curPage * size);

  // ID columns are hidden from the UI (still available in CSV export).
  const visibleColumns = columns.filter((c) => c.type !== 'id');

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  };

  // Giá trị có sẵn của một cột (để chọn trong bộ lọc).
  const distinctValues = (c: Column): string[] => {
    const set = new Set<string>();
    for (const r of applyActiveFilters(rows, { columnKey: c.key })) for (const v of cellValues(c, r)) set.add(v);
    // Cùng thứ tự với dropdown trong form: số → Latin → Hán (pinyin).
    return Array.from(set).sort(compareGroupedLabels);
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
      const raw = Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean);
      // Sắp các thẻ trong ô theo A→Z (hàng ngang).
      const arr = [...raw].sort((a, b) => String(a).localeCompare(String(b)));
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
        {/* Bộ lọc dropdown trên thanh công cụ đã ẩn — dùng hàng lọc theo cột (nút "Lọc"). */}
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
            {showFilters && (
              <tr className="bg-white border-b border-gray-100">
                {visibleColumns.map((c) => (
                  <th key={c.key} className="px-2 py-2 font-normal normal-case">
                    {noFilter(c) || (filterKeys && !filterKeys.includes(c.key)) ? null : c.type === 'toggle' ? (
                      <select value={colFilters[c.key] ?? ''} onChange={(e) => { setColFilters((v) => ({ ...v, [c.key]: e.target.value })); setPage(1); }}
                        className="w-full h-7 px-1.5 rounded border border-gray-200 text-xs bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-cyan-300">
                        <option value="">{t('common.all')}</option>
                        {sortByGroupedLabel([
                          { value: 'on', label: t('common.on') },
                          { value: 'off', label: t('common.off') },
                        ], (o) => o.label).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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

      <Pager total={filtered.length} page={curPage} totalPages={totalPages} pageSize={size}
        onPage={setPage} onPageSize={setSize} />
    </div>
  );
}
