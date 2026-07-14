import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCalendar } from './icons';

interface Props {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) ? new Date(y, m - 1, d) : new Date();
};
const addDays = (d: Date, n: number) => {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
};
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const yesterday = () => addDays(new Date(), -1);
const normalizeRange = (a: string, b: string): readonly [string, string] => (a <= b ? [a, b] : [b, a]);

function monthCells(month: Date) {
  const first = startOfMonth(month);
  const gridStart = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    return { date, value: ymd(date), current: date.getMonth() === month.getMonth() };
  });
}

const PANEL_W = 650;

export function DateRangePicker({ from, to, onFromChange, onToChange, disabled = false, className = '' }: Props) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Panel neo right-0 sẽ tràn qua mép trái <main> (overflow-x-hidden) và bị cắt khi
  // ô chọn ngày nằm gần bên trái → đo lúc mở, không đủ chỗ thì đổi sang neo trái.
  const [alignLeft, setAlignLeft] = useState(false);
  useEffect(() => {
    if (!open || !rootRef.current) return;
    const r = rootRef.current.getBoundingClientRect();
    const clipLeft = rootRef.current.closest('main')?.getBoundingClientRect().left ?? 0;
    setAlignLeft(r.right - PANEL_W < clipLeft + 8);
  }, [open]);
  // Neo theo NGÀY CUỐI của khoảng: panel hiện [tháng trước đó | tháng chứa `to`],
  // nên khoảng dài tới 2 tháng vẫn thấy trọn (nghiệp vụ nhìn lùi, không cần tháng sau).
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(to || from ? parseYmd(to || from) : new Date()));
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) return;
    setDraftFrom(from);
    setDraftTo(to);
    if (to || from) setViewMonth(startOfMonth(parseYmd(to || from)));
  }, [from, to, open]);

  const [rangeStart, rangeEnd] = useMemo(() => {
    if (!draftFrom && !draftTo) return ['', ''] as const;
    if (!draftTo) return [draftFrom, draftFrom] as const;
    if (!draftFrom) return [draftTo, draftTo] as const;
    return normalizeRange(draftFrom, draftTo);
  }, [draftFrom, draftTo]);

  const applyRange = (nextFrom = draftFrom, nextTo = draftTo) => {
    if (!nextFrom && !nextTo) {
      onFromChange('');
      onToChange('');
      setOpen(false);
      return;
    }
    const [lo, hi] = normalizeRange(nextFrom || nextTo, nextTo || nextFrom);
    onFromChange(lo);
    onToChange(hi);
    setDraftFrom(lo);
    setDraftTo(hi);
    setOpen(false);
  };

  const weekDays = t('datePicker.weekDays', { returnObjects: true }) as string[];
  const monthNames = t('datePicker.months', { returnObjects: true }) as string[];

  const thisMonthPreset = { label: t('datePicker.thisMonth'), range: () => [ymd(startOfMonth(new Date())), ymd(yesterday())] as const };
  const lastMonthPreset = { label: t('datePicker.lastMonth'), range: () => { const firstThis = startOfMonth(new Date()); return [ymd(addMonths(firstThis, -1)), ymd(addDays(firstThis, -1))] as const; } };
  const presets = [lastMonthPreset, thisMonthPreset];

  const renderPresets = () => (
    <div className="flex flex-wrap items-center gap-1.5">
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          disabled={disabled}
          onClick={() => {
            const [lo, hi] = p.range();
            onFromChange(lo);
            onToChange(hi);
            setDraftFrom(lo);
            setDraftTo(hi);
            setViewMonth(startOfMonth(parseYmd(hi)));
          }}
          className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {p.label}
        </button>
      ))}
    </div>
  );

  const pickDate = (value: string) => {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(value);
      setDraftTo('');
      return;
    }
    const [lo, hi] = normalizeRange(draftFrom, value);
    setDraftFrom(lo);
    setDraftTo(hi);
  };

  const renderMonth = (month: Date) => (
    <div className="w-[292px]">
      <div className="mb-3 text-center text-sm font-semibold text-gray-800">
        {t('datePicker.monthYear', { month: monthNames[month.getMonth()], year: month.getFullYear() })}
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-gray-400 mb-1">
        {weekDays.map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 text-center text-sm">
        {monthCells(month).map(({ date, value, current }) => {
          const isStart = value === rangeStart;
          const isEnd = value === rangeEnd;
          const inRange = !!rangeStart && !!rangeEnd && value > rangeStart && value < rangeEnd;
          return (
            <button
              key={value}
              type="button"
              disabled={!current}
              onClick={() => pickDate(value)}
              className={`h-9 relative disabled:cursor-default disabled:text-gray-300 ${current ? 'text-gray-700 hover:bg-blue-50' : 'bg-gray-50'} ${inRange ? 'bg-blue-50 hover:bg-blue-50' : ''}`}
            >
              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${isStart || isEnd ? 'bg-blue-600 text-white font-semibold' : ''}`}>
                {date.getDate()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={`relative flex flex-wrap items-center gap-2 ${className}`}>
      <div className="h-9 min-w-[270px] inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setDraftFrom(from);
            setDraftTo(to);
            if (to || from) setViewMonth(startOfMonth(parseYmd(to || from)));
            setOpen(true);
          }}
          className="min-w-0 flex-1 inline-flex items-center gap-2 disabled:opacity-60"
        >
          <IconCalendar width={16} height={16} className="text-gray-400 shrink-0" />
          <span className="flex-1 text-left whitespace-nowrap">{from && to ? `${from} ~ ${to}` : 'YYYY-MM-DD ~ YYYY-MM-DD'}</span>
        </button>
        {(from || to) && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => applyRange('', '')}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            ×
          </button>
        )}
      </div>

      {renderPresets()}

      {open && !disabled && (
        <div className={`absolute ${alignLeft ? 'left-0' : 'right-0'} top-[calc(100%+8px)] z-[60] w-[650px] max-w-[calc(100vw-18rem)] rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl`}>
          <div className="mb-3 flex items-center justify-between text-gray-500">
            <div className="flex gap-1">
              <button type="button" onClick={() => setViewMonth(addMonths(viewMonth, -12))} className="h-8 w-8 rounded-lg hover:bg-gray-100">«</button>
              <button type="button" onClick={() => setViewMonth(addMonths(viewMonth, -1))} className="h-8 w-8 rounded-lg hover:bg-gray-100">‹</button>
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => setViewMonth(addMonths(viewMonth, 1))} className="h-8 w-8 rounded-lg hover:bg-gray-100">›</button>
              <button type="button" onClick={() => setViewMonth(addMonths(viewMonth, 12))} className="h-8 w-8 rounded-lg hover:bg-gray-100">»</button>
            </div>
          </div>
          {/* Nghiệp vụ luôn nhìn LÙI (hôm qua, tháng trước) → tháng đang chọn nằm bên PHẢI,
              bên trái là tháng liền trước; không phí nửa panel cho tháng sau chưa có số liệu. */}
          <div className="flex flex-wrap justify-center gap-6">
            {renderMonth(addMonths(viewMonth, -1))}
            {renderMonth(viewMonth)}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
            <div className="text-sm text-gray-500">{rangeStart && rangeEnd ? `${rangeStart} ~ ${rangeEnd}` : t('datePicker.selectRange')}</div>
            <button type="button" onClick={() => applyRange()} className="h-9 px-5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
              {t('common.apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
