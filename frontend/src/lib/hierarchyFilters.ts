export const hierarchyKey = (value: unknown) => String(value ?? '').trim().toLowerCase();

const facetValue = (value: unknown) => String(value ?? '');

export interface BidirectionalFacetResult<T, K extends string> {
  rows: T[];
  options: Record<K, Set<string>>;
}

/**
 * Lọc facet hai chiều: dữ liệu của mỗi dropdown chịu ảnh hưởng của tất cả
 * dropdown CÒN LẠI, nhưng không tự lọc theo chính nó. Nhờ vậy người dùng vẫn
 * có thể đổi giá trị hiện tại trong toàn bộ tập tương thích.
 */
export function bidirectionalFacetOptions<T, K extends string>(
  rows: readonly T[],
  selections: Record<K, string>,
  valueOf: Record<K, (row: T) => unknown>,
): BidirectionalFacetResult<T, K> {
  const facets = Object.keys(selections) as K[];
  const matches = (row: T, except?: K) => facets.every((facet) =>
    facet === except || !selections[facet] || facetValue(valueOf[facet](row)) === selections[facet]);

  const options = {} as Record<K, Set<string>>;
  for (const facet of facets) {
    options[facet] = new Set(
      rows
        .filter((row) => matches(row, facet))
        .map((row) => facetValue(valueOf[facet](row)))
        .filter(Boolean),
    );
  }

  return { rows: rows.filter((row) => matches(row)), options };
}
