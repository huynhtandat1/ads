import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { bidirectionalFacetOptions, hierarchyKey } from '../frontend/src/lib/hierarchyFilters.ts';

const rows = [
  { parent: '1', order: 'common', item: '100', type: 'CPA', price: '10', status: 'online' },
  { parent: '1', order: 'only a', item: '101', type: 'CPM', price: '20', status: 'offline' },
  { parent: '2', order: 'common', item: '200', type: 'CPA', price: '30', status: 'offline' },
  { parent: '2', order: 'only b', item: '201', type: 'CPS', price: '40', status: 'online' },
];

type Facet = 'parent' | 'order' | 'item' | 'type' | 'price' | 'status';
const empty: Record<Facet, string> = {
  parent: '', order: '', item: '', type: '', price: '', status: '',
};
const options = (selected: Partial<Record<Facet, string>> = {}) => bidirectionalFacetOptions(
  rows,
  { ...empty, ...selected },
  {
    parent: (row) => row.parent,
    order: (row) => hierarchyKey(row.order),
    item: (row) => row.item,
    type: (row) => row.type,
    price: (row) => row.price,
    status: (row) => row.status,
  },
);
const values = (set: Set<string>) => [...set];

describe('bidirectionalFacetOptions()', () => {
  test('không chọn gì: giữ toàn bộ dữ liệu và toàn bộ option', () => {
    const result = options();
    assert.equal(result.rows.length, 4);
    assert.deepEqual(values(result.options.parent), ['1', '2']);
    assert.deepEqual(values(result.options.order), ['common', 'only a', 'only b']);
  });

  test('chọn parent: lọc các facet phía sau', () => {
    const result = options({ parent: '1' });
    assert.deepEqual(result.rows.map((row) => row.item), ['100', '101']);
    assert.deepEqual(values(result.options.order), ['common', 'only a']);
    assert.deepEqual(values(result.options.type), ['CPA', 'CPM']);
    assert.deepEqual(values(result.options.price), ['10', '20']);
  });

  test('chọn order: lọc ngược parent và lọc xuôi item', () => {
    const result = options({ order: 'common' });
    assert.deepEqual(values(result.options.parent), ['1', '2']);
    assert.deepEqual(values(result.options.item), ['100', '200']);
  });

  test('chọn item: lọc ngược chính xác các facet còn lại', () => {
    const result = options({ item: '201' });
    assert.deepEqual(values(result.options.parent), ['2']);
    assert.deepEqual(values(result.options.order), ['only b']);
    assert.deepEqual(values(result.options.type), ['CPS']);
    assert.deepEqual(values(result.options.status), ['online']);
  });

  test('chọn Loại: lọc ngược parent, order, item, giá và trạng thái', () => {
    const result = options({ type: 'CPA' });
    assert.deepEqual(result.rows.map((row) => row.item), ['100', '200']);
    assert.deepEqual(values(result.options.parent), ['1', '2']);
    assert.deepEqual(values(result.options.order), ['common']);
    assert.deepEqual(values(result.options.item), ['100', '200']);
    assert.deepEqual(values(result.options.price), ['10', '30']);
    assert.deepEqual(values(result.options.status), ['online', 'offline']);
  });

  test('mỗi facet không tự khóa chính nó', () => {
    const result = options({ parent: '1', type: 'CPA' });
    assert.deepEqual(values(result.options.parent), ['1', '2']);
    assert.deepEqual(values(result.options.type), ['CPA', 'CPM']);
    assert.deepEqual(result.rows.map((row) => row.item), ['100']);
  });
});
