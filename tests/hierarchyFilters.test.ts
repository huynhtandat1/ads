import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { bidirectionalHierarchyOptions, hierarchyKey } from '../frontend/src/lib/hierarchyFilters.ts';

const parents = [
  { id: 1, name: 'Parent A' },
  { id: 2, name: 'Parent B' },
];
const orders = [
  { id: 10, parentId: 1, name: 'Common' },
  { id: 11, parentId: 1, name: 'Only A' },
  { id: 20, parentId: 2, name: 'Common' },
  { id: 21, parentId: 2, name: 'Only B' },
];
const items = [
  { id: 100, parentId: 1, orderId: 10, name: 'A-Common' },
  { id: 101, parentId: 1, orderId: 11, name: 'A-Only' },
  { id: 200, parentId: 2, orderId: 20, name: 'B-Common' },
  { id: 201, parentId: 2, orderId: 21, name: 'B-Only' },
];

const options = (parentId = '', orderKey = '', itemId = '') => bidirectionalHierarchyOptions({
  parents, orders, items, parentId, orderKey, itemId,
  orderParentField: 'parentId', itemParentField: 'parentId', itemOrderField: 'orderId',
});
const ids = (rows: { id: number }[]) => rows.map((row) => row.id);
const names = (rows: { name?: unknown }[]) => rows.map((row) => hierarchyKey(row.name));

describe('bidirectionalHierarchyOptions()', () => {
  test('không chọn gì: giữ toàn bộ cây và gộp đơn trùng tên', () => {
    const result = options();
    assert.deepEqual(ids(result.parentOptions), [1, 2]);
    assert.deepEqual(names(result.orderOptions), ['common', 'only a', 'only b']);
    assert.deepEqual(ids(result.itemOptions), [100, 101, 200, 201]);
  });

  test('chọn parent: lọc order và item xuống dưới', () => {
    const result = options('1');
    assert.deepEqual(names(result.orderOptions), ['common', 'only a']);
    assert.deepEqual(ids(result.itemOptions), [100, 101]);
  });

  test('chọn order: lọc ngược parent và lọc xuôi item', () => {
    const result = options('', 'common');
    assert.deepEqual(ids(result.parentOptions), [1, 2]);
    assert.deepEqual(ids(result.itemOptions), [100, 200]);
    assert.deepEqual([...result.matchingOrderIds!], [10, 20]);
  });

  test('chọn item: lọc ngược chính xác parent và order', () => {
    const result = options('', '', '201');
    assert.deepEqual(ids(result.parentOptions), [2]);
    assert.deepEqual(names(result.orderOptions), ['only b']);
  });

  test('kết hợp parent + order: chỉ còn item tương thích', () => {
    const result = options('2', 'common');
    assert.deepEqual(ids(result.itemOptions), [200]);
  });
});
