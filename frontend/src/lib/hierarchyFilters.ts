import type { Row } from '../data/store';

export const hierarchyKey = (value: unknown) => String(value ?? '').trim().toLowerCase();

interface HierarchyArgs {
  parents: Row[];
  orders: Row[];
  items: Row[];
  parentId: string;
  orderKey: string;
  itemId: string;
  orderParentField: string;
  itemParentField: string;
  itemOrderField: string;
}

export interface HierarchyOptions {
  parentOptions: Row[];
  orderOptions: Row[];
  itemOptions: Row[];
  matchingOrderIds: Set<number> | null;
}

/**
 * Tạo ba facet phụ thuộc hai chiều cho quan hệ Parent → Order → Item.
 * Mỗi danh sách option chịu ảnh hưởng của HAI lựa chọn còn lại, nhưng không tự
 * lọc theo chính nó để người dùng vẫn có thể đổi lựa chọn trong tập tương thích.
 */
export function bidirectionalHierarchyOptions({
  parents, orders, items, parentId, orderKey, itemId,
  orderParentField, itemParentField, itemOrderField,
}: HierarchyArgs): HierarchyOptions {
  const orderById = new Map(orders.map((o) => [String(o.id), o] as const));
  const normalizedOrderKey = hierarchyKey(orderKey);
  const itemMatchesOrder = (item: Row) =>
    !normalizedOrderKey || hierarchyKey(orderById.get(String(item[itemOrderField]))?.name) === normalizedOrderKey;

  const parentOptions = !normalizedOrderKey && !itemId
    ? parents
    : parents.filter((parent) => items.some((item) =>
      String(item[itemParentField]) === String(parent.id) &&
      itemMatchesOrder(item) &&
      (!itemId || String(item.id) === itemId)));

  const orderCandidates = orders.filter((order) => {
    if (parentId && String(order[orderParentField]) !== parentId) return false;
    return items.some((item) =>
      String(item[itemOrderField]) === String(order.id) &&
      (!parentId || String(item[itemParentField]) === parentId) &&
      (!itemId || String(item.id) === itemId));
  });
  const seenOrderNames = new Set<string>();
  const orderOptions = orderCandidates.filter((order) => {
    const key = hierarchyKey(order.name);
    if (!key || seenOrderNames.has(key)) return false;
    seenOrderNames.add(key);
    return true;
  });

  const itemOptions = items.filter((item) =>
    (!parentId || String(item[itemParentField]) === parentId) && itemMatchesOrder(item));

  const matchingOrderIds = normalizedOrderKey
    ? new Set(orders.filter((order) => hierarchyKey(order.name) === normalizedOrderKey).map((order) => Number(order.id)))
    : null;

  return { parentOptions, orderOptions, itemOptions, matchingOrderIds };
}
