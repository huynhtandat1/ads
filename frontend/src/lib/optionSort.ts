// Sắp nhãn theo nhóm ký tự đầu: 0 số → 1 Latin → 2 chữ Hán (pinyin) → 3 còn lại.
// Dùng chung cho dropdown trong form (FormModal) và dropdown lọc theo cột (DataTable).
const groupOfFirstChar = (label: string): number => {
  const ch = label.charAt(0);
  if (!ch) return 3;
  if (/[0-9]/.test(ch)) return 0;
  if (/[a-zA-Z]/.test(ch)) return 1;
  if (/[㐀-鿿豈-﫿]/.test(ch)) return 2;
  return 3;
};

const collator = new Intl.Collator('zh-Hans-u-co-pinyin', { numeric: true, sensitivity: 'base' });

export function compareGroupedLabels(a: string, b: string): number {
  const la = a.trim(), lb = b.trim();
  const ga = groupOfFirstChar(la), gb = groupOfFirstChar(lb);
  if (ga !== gb) return ga - gb;
  return collator.compare(la, lb);
}
