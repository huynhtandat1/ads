import { useTranslation } from 'react-i18next';

export const PAGE_SIZES = [10, 30, 50];

interface Props {
  total: number;        // tổng số dòng sau lọc
  page: number;         // trang hiện tại (đã clamp)
  totalPages: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}

/** Footer phân trang thống nhất toàn site: tổng số dòng + chọn 10/30/50 dòng/trang + lật trang. */
export function Pager({ total, page, totalPages, pageSize, onPage, onPageSize }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm text-gray-500 border-t border-gray-100">
      <div className="flex items-center gap-2">
        <span>{t('common.total')} {total} {t('common.rows')}</span>
        <select value={pageSize} onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }}
          className="h-8 px-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-200">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} {t('common.perPage')}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)}
          className="h-8 px-3 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹</button>
        <span className="px-3">{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)}
          className="h-8 px-3 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">›</button>
      </div>
    </div>
  );
}
