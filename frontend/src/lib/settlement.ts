export type SettlementPreviewType = 'adv' | 'media';

/**
 * Sinh mã phiếu chưa tồn tại trong snapshot hiện tại.
 * PostgreSQL vẫn là lớp bảo vệ cuối cùng nếu hai client cùng sinh một mã đồng thời.
 */
export function nextSettlementCode(
  existingCodes: Iterable<unknown>,
  previewType: SettlementPreviewType,
  from: string,
  random: () => number = Math.random,
): string {
  const prefix = previewType === 'media' ? 'ST-MED' : 'ST-ADV';
  const base = `${prefix}-${from.slice(2, 7).replace('-', '')}`;
  const used = new Set(
    Array.from(existingCodes, (code) => String(code ?? '').trim().toLowerCase()),
  );

  // Giữ suffix 2 chữ số khi còn chỗ, bắt đầu ở một vị trí ngẫu nhiên rồi quét
  // toàn bộ 10..99 để chắc chắn không chọn mã đã dùng.
  const start = Math.floor(random() * 90) + 10;
  for (let offset = 0; offset < 90; offset++) {
    const suffix = 10 + ((start - 10 + offset) % 90);
    const code = `${base}-${suffix}`;
    if (!used.has(code.toLowerCase())) return code;
  }

  // Nếu một tháng đã vượt 90 phiếu, mở rộng suffix thay vì quay lại mã cũ.
  let suffix = 100;
  while (used.has(`${base}-${suffix}`.toLowerCase())) suffix++;
  return `${base}-${suffix}`;
}
