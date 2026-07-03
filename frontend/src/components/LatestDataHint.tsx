import { useTranslation } from 'react-i18next';
import { getAll } from '../data/store';

// Nút nhảy nhanh tới ngày có dữ liệu gần nhất. Mặc định các màn vào "hôm qua",
// nhưng nếu dữ liệu trong DB cũ hơn (demo/import) thì người dùng chỉ thấy "暂无数据"
// mà không biết vì sao — nút này chỉ đường tới chỗ có dữ liệu.
// Trang cha đã subscribe các collection tương ứng nên component tự re-render theo dữ liệu.
export function LatestDataHint({ collections, current, onPick }: {
  collections: string[];
  current?: string;            // ngày/khoảng đang chọn — trùng ngày mới nhất thì ẩn nút
  onPick: (date: string) => void;
}) {
  const { t } = useTranslation();
  let latest = '';
  for (const c of collections) {
    for (const r of getAll(c)) {
      if (typeof r.date === 'string' && r.date > latest) latest = r.date;
    }
  }
  if (!latest || latest === current) return null;
  return (
    <button onClick={() => onPick(latest)} title={t('entry.latestData')}
      className="h-9 px-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700 hover:bg-amber-100 whitespace-nowrap">
      📅 {t('entry.latestData')}: {latest}
    </button>
  );
}
