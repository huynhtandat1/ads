const RATE_SCREEN_RULES: Record<string, readonly string[]> = {
  'adId:unitPrice': ['g1c', 'g3a', 'g3b'],
  'mediaId:unitPrice': ['g2c', 'g3c'],
  'mediaId:profitShare': ['g2c', 'g3c'],
  'mediaId:coefficient': ['g3c'],
  'tax:point': ['g4b'],
};

/** Màn hình nào được phép thay đổi đúng loại rate nào. */
export function isAllowedRateScreen(entityType: string, field: string, screen: string): boolean {
  return RATE_SCREEN_RULES[`${entityType}:${field}`]?.includes(screen) ?? false;
}
