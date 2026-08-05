import test from 'node:test';
import assert from 'node:assert/strict';
import { compareGroupedLabels, sortByGroupedLabel } from '../frontend/src/lib/optionSort.ts';

test('report ID sort uses natural numeric ordering', () => {
  const ids = ['wxsm76', 't10', '224', 't9', '223'];
  const sorted = [...ids].sort(compareGroupedLabels);

  assert.deepEqual(sorted, ['223', '224', 't9', 't10', 'wxsm76']);
  assert.deepEqual(ids, ['wxsm76', 't10', '224', 't9', '223'], 'không mutate dữ liệu nguồn');
});

test('report ID sort supports descending direction', () => {
  const ids = ['t9', 't10', '223'];
  assert.deepEqual([...ids].sort((a, b) => compareGroupedLabels(a, b) * -1), ['t10', 't9', '223']);
});

test('shared option sorter returns a sorted copy', () => {
  const rows = [{ name: 't10' }, { name: 't9' }];
  const sorted = sortByGroupedLabel(rows, (row) => row.name);

  assert.deepEqual(sorted.map((row) => row.name), ['t9', 't10']);
  assert.deepEqual(rows.map((row) => row.name), ['t10', 't9']);
});
