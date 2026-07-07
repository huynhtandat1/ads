import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const tomorrow = (from: string) => {
  const d = new Date(from + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

interface Props {
  value: number;                 // giá trị có hiệu lực hiện tại (đã resolve)
  workingDate: string;           // ngày đang thao tác (cho "hiệu lực hiện tại")
  suffix?: string;               // vd '%'
  disabled?: boolean;
  integer?: boolean;             // CPS nhập phần trăm nguyên: 80 = 80%
  onSet: (value: number, effectiveFrom: string) => void;
}

// Ô hiển thị giá trị + popover sửa kèm 2 lựa chọn hiệu lực theo mốc ngày.
export function RateEditor({ value, workingDate, suffix = '', disabled, integer, onSet }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(String(value));
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [laterDate, setLaterDate] = useState(tomorrow(workingDate));

  const start = () => { setVal(String(value)); setMode('now'); setLaterDate(tomorrow(workingDate)); setOpen(true); };
  // Bấm Lưu hoặc bấm RA NGOÀI popover đều lưu; chỉ ghi phiên bản mới khi giá trị
  // thực sự đổi (mở xem rồi bấm ra ngoài không tạo rate rác). Nút Hủy mới là bỏ qua.
  const save = () => {
    const v = Number(val);
    if (!isNaN(v) && val.trim() !== '' && v !== value) onSet(v, mode === 'now' ? workingDate : laterDate);
    setOpen(false);
  };

  return (
    <div className="relative inline-block">
      <button disabled={disabled} onClick={start}
        className="h-7 px-2 rounded text-sm font-medium text-gray-700 hover:bg-cyan-50 disabled:opacity-60 disabled:hover:bg-transparent">
        {value}{suffix}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={save} />
          <div className="absolute z-50 mt-1 left-0 w-60 bg-white rounded-lg border border-gray-200 shadow-xl p-3 text-left">
            <div className="relative mb-2">
              <input type="number" step={integer ? 1 : 0.01} autoFocus value={val}
                onChange={(e) => setVal(integer ? e.target.value.replace(/\D/g, '') : e.target.value)}
                className={`w-full h-8 px-2 ${suffix ? 'pr-6' : ''} rounded border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200`} />
              {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{suffix}</span>}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 mb-1 cursor-pointer">
              <input type="radio" checked={mode === 'now'} onChange={() => setMode('now')} className="accent-cyan-500" />
              {t('entry.effNow')} <span className="text-gray-400">({workingDate})</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 mb-2 cursor-pointer">
              <input type="radio" checked={mode === 'later'} onChange={() => setMode('later')} className="accent-cyan-500" />
              {t('entry.effLater')}
            </label>
            {mode === 'later' && (
              <input type="date" value={laterDate} min={tomorrow(workingDate)} onChange={(e) => setLaterDate(e.target.value)}
                className="w-full h-8 px-2 mb-2 rounded border border-gray-200 text-sm" />
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="h-7 px-2.5 rounded border border-gray-200 text-xs text-gray-600 hover:bg-gray-50">{t('common.cancel')}</button>
              <button onClick={save} className="h-7 px-2.5 rounded bg-cyan-500 text-white text-xs font-medium hover:bg-cyan-600">{t('common.save')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
