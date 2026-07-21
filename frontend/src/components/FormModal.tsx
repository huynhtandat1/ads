import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAll, type Row } from '../data/store';
import { compareGroupedLabels } from '../lib/optionSort';
import { Toggle } from './Toggle';
import { IconTrash } from './icons';

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'email' | 'select' | 'percent' | 'toggle' | 'password';
  required?: boolean;
  optionsFrom?: string;       // collection for dynamic select
  optionLabel?: string;       // label field (default 'name')
  optionValue?: string;       // value field (default 'id')
  filterBy?: { field: string; parentKey: string }; // option.field === value[parentKey]
  options?: { value: string; label: string }[];     // static options
  default?: unknown;
  step?: number;
  hint?: string;
  half?: boolean;                                    // nửa hàng (2 cột)
  labelMap?: { watch: string; options: Record<string, string>; default: string }; // nhãn động theo field khác
  derive?: { watch: string; from: string; source: string }; // giá trị tự lấy từ bản ghi field khác trỏ tới → read-only
  hidden?: boolean; // không render trong form (vẫn giữ/derive/validate giá trị)
  digitsOnly?: boolean; // chỉ cho nhập chữ số (vd: số điện thoại)
  skipRequiredOnEdit?: boolean; // field required khi tạo, không required khi sửa (vd: password)
  placeholder?: string;     // raw placeholder
  placeholderKey?: string;  // i18n key cho placeholder
  sortActiveOptions?: boolean; // dropdown optionsFrom: lọc status=false + xếp theo nhóm ký tự đầu
  usedOnce?: { collection: string; field: string }; // ẩn option đã được bản ghi khác trong collection.field dùng
}

interface Props {
  title: string;
  fields: FieldDef[];
  initial?: Row | null;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
  onDelete?: () => void; // shown inside the edit modal (existing record only)
}

export function FormModal({ title, fields, initial, onClose, onSubmit, onDelete }: Props) {
  const { t } = useTranslation();
  const [vals, setVals] = useState<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = {};
    for (const f of fields) base[f.key] = initial?.[f.key] ?? f.default ?? (f.type === 'toggle' ? true : '');
    return base;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const set = (key: string, v: unknown) => setVals((s) => ({ ...s, [key]: v }));
  const isIntegerField = (f: FieldDef) => f.key === 'unitPrice' && vals.type === 'CPS';
  const isNumericField = (f: FieldDef) => f.type === 'number' || f.type === 'percent';
  const cleanInput = (f: FieldDef, v: string) => {
    if (f.digitsOnly) return v.replace(/\D/g, '');
    return v;
  };
  const isValidNumberText = (v: unknown) => /^\d+(\.\d+)?$/.test(String(v));

  // Số → Latin → Hán (pinyin); giữ thứ tự ổn định bằng value.
  const compareGroupedOptionLabels = (a: { value: string; label: string }, b: { value: string; label: string }) =>
    compareGroupedLabels(String(a.label), String(b.label)) || a.value.localeCompare(b.value);

  // Tự lấy giá trị field derive từ bản ghi mà field 'watch' đang trỏ tới (vd: Loại lấy từ ID quảng cáo).
  useEffect(() => {
    for (const f of fields) {
      if (!f.derive) continue;
      const ref = vals[f.derive.watch];
      const src = ref ? getAll(f.derive.from).find((r) => String(r.id) === String(ref)) : undefined;
      const derived = src ? src[f.derive.source] : '';
      if (String(vals[f.key] ?? '') !== String(derived ?? '')) set(f.key, derived ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.map((f) => (f.derive ? vals[f.derive.watch] : '')).join('|')]);

  const submit = () => {
    const errs: Record<string, string> = {};
    const isEdit = !!initial;
    for (const f of fields) {
      const raw = vals[f.key];
      // skipRequiredOnEdit: required khi tạo, không required khi sửa (vd password).
      const required = f.required && !(f.skipRequiredOnEdit && isEdit);
      if (required && (raw === '' || raw == null)) {
        errs[f.key] = t('common.required');
        continue;
      }
      if (isNumericField(f) && raw !== '' && raw != null) {
        const n = Number(raw);
        if (!isValidNumberText(raw) || !Number.isFinite(n)) errs[f.key] = t('common.invalidNumber');
        else if (f.key === 'unitPrice' && vals.type === 'CPS' && n > 100) errs[f.key] = t('common.invalidPercent');
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const out: Record<string, unknown> = { ...vals };
    for (const f of fields) {
      if ((f.type === 'number' || f.type === 'percent') && out[f.key] !== '') out[f.key] = Number(out[f.key]);
      if (f.optionsFrom && (f.optionValue ?? 'id') === 'id' && out[f.key] !== '') out[f.key] = Number(out[f.key]);
    }
    onSubmit(out);
  };

  const optionsFor = (f: FieldDef): { value: string; label: string }[] => {
    if (f.options) return f.options;
    if (f.optionsFrom) {
      let rows = getAll(f.optionsFrom) as Row[];
      if (f.filterBy) {
        const parentVal = vals[f.filterBy.parentKey];
        rows = parentVal ? rows.filter((r) => String(r[f.filterBy!.field]) === String(parentVal)) : [];
      }
      if (f.sortActiveOptions) rows = rows.filter((r) => r.status !== false);
      // Mỗi option chỉ được 1 bản ghi dùng: loại các giá trị đã bị bản ghi khác chiếm
      // (giữ lại giá trị của chính bản ghi đang sửa).
      if (f.usedOnce) {
        const used = new Set(
          getAll(f.usedOnce.collection)
            .filter((r) => r.id !== initial?.id)
            .map((r) => String(r[f.usedOnce!.field] ?? '')),
        );
        rows = rows.filter((r) => !used.has(String(r[f.optionValue || 'id'])));
      }
      const opts = rows.map((r) => ({ value: String(r[f.optionValue || 'id']), label: String(r[f.optionLabel || 'name']) }));
      if (f.sortActiveOptions) opts.sort(compareGroupedOptionLabels);
      return opts;
    }
    return [];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="text-lg font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          {fields.filter((f) => !f.hidden).map((f) => (
            <div key={f.key} className={f.half ? 'col-span-1' : 'col-span-2'}>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">
                {(f.labelMap ? (f.labelMap.options[String(vals[f.labelMap.watch] ?? '')] ?? f.labelMap.default) : f.label)} {f.required && !(f.skipRequiredOnEdit && initial) && <span className="text-rose-500">*</span>}
              </label>
              {f.type === 'toggle' ? (
                <Toggle on={!!vals[f.key]} onChange={() => set(f.key, !vals[f.key])} />
              ) : f.type === 'textarea' ? (
                <textarea value={String(vals[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} rows={2}
                  className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200 ${errors[f.key] ? 'border-rose-400' : 'border-gray-200'}`} />
              ) : f.type === 'select' ? (
                <select value={String(vals[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} disabled={!!f.derive}
                  className={`w-full px-3 py-2 rounded-lg border text-sm bg-white focus:outline-none focus:ring-2 focus:ring-cyan-200 disabled:bg-gray-50 disabled:text-gray-500 ${errors[f.key] ? 'border-rose-400' : 'border-gray-200'}`}>
                  <option value="">{t('common.selectPh')}</option>
                  {optionsFor(f).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <div className="relative">
                  <input
                    type={f.type === 'email' ? 'email' : f.type === 'password' ? 'password' : 'text'}
                    inputMode={f.digitsOnly || isIntegerField(f) ? 'numeric' : isNumericField(f) ? 'decimal' : undefined}
                    value={String(vals[f.key] ?? '')}
                    placeholder={f.placeholder ?? (f.placeholderKey ? t(f.placeholderKey) : undefined)}
                    onChange={(e) => set(f.key, cleanInput(f, e.target.value))}
                    autoComplete={f.type === 'password' ? 'new-password' : undefined}
                    className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200 ${f.type === 'percent' ? 'pr-8' : ''} ${errors[f.key] ? 'border-rose-400' : 'border-gray-200'}`} />
                  {f.type === 'percent' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>}
                </div>
              )}
              {errors[f.key] && <p className="text-xs text-rose-500 mt-1">{errors[f.key]}</p>}
              {f.hint && <p className="text-xs text-gray-400 mt-1">{f.hint}</p>}
            </div>
          ))}
        </div>
        <div className="flex items-center px-6 py-4 border-t border-gray-100">
          {onDelete && (
            <button onClick={onDelete}
              className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 text-sm text-rose-600 hover:bg-rose-50">
              <IconTrash width={16} height={16} /> {t('common.delete')}
            </button>
          )}
          <div className="flex-1" />
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">{t('common.cancel')}</button>
            <button onClick={submit} className="h-9 px-4 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600">{t('common.save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
