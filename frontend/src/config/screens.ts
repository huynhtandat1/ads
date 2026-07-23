import type { Row } from '../data/store';
import { getAll, effectiveValue } from '../data/store';
import { ymd } from '../lib/date';

// Giá trị hiệu lực HÔM NAY theo lịch sử 'rates' (fallback = giá trị lưu trên bản ghi).
// Danh mục g1c/g2c hiển thị giá trị này để khớp với màn nhập liệu (g3b/g3c) vốn đọc
// effectiveValue — nếu hiện raw value sẽ lệch khi đơn giá/tỷ lệ đã đổi qua RateEditor.
const effToday = (entityType: string, r: Row, field: string) =>
  effectiveValue(entityType, r.id, field, ymd(new Date()), Number(r[field]) || 0);

export interface CrudColumn {
  key: string;
  labelKey: string;
  type?: 'id' | 'text' | 'tags' | 'number' | 'currency' | 'percent' | 'badge';
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  compute?: (row: Row) => unknown;
  ref?: { collection: string; field?: string };
}

export interface CrudFieldCfg {
  key: string;
  labelKey: string;
  type: 'text' | 'textarea' | 'number' | 'email' | 'select' | 'percent' | 'password';
  required?: boolean;
  optionsFrom?: string;
  optionLabel?: string;
  optionValue?: string;
  filterBy?: { field: string; parentKey: string };
  options?: { value: string; labelKey: string }[];
  default?: unknown;
  step?: number;
  hintKey?: string;
  dynLabel?: { watch: string; map: Record<string, string>; default: string }; // nhãn động theo field khác (labelKey)
  derive?: { watch: string; from: string; source: string }; // giá trị lấy tự động từ bản ghi field khác trỏ tới
  hidden?: boolean; // không hiển thị trong form (vẫn giữ/derive giá trị)
  digitsOnly?: boolean; // chỉ cho nhập chữ số (vd: số điện thoại)
  skipRequiredOnEdit?: boolean; // required khi tạo, không required khi sửa (vd password)
  placeholderKey?: string; // i18n key cho placeholder
  sortActiveOptions?: boolean; // dropdown optionsFrom: ẩn bản ghi đã tắt + xếp số → Latin → Hán (pinyin)
  usedOnce?: { collection: string; field: string }; // ẩn option đã được bản ghi khác trong collection.field dùng
}

export interface FilterCfg {
  key: string;
  labelKey: string;
  from?: string;                              // dynamic options from collection
  static?: { value: string; labelKey: string }[];
}

export interface ScreenConfig {
  screen: string;
  collection: string;
  titleKey: string;
  columns: CrudColumn[];
  fields: CrudFieldCfg[];
  filters?: FilterCfg[];
  uniqueKeys?: string[]; // tổ hợp field phải duy nhất (không phân biệt hoa/thường). 1 field = duy nhất đơn; nhiều = cặp duy nhất
  filterKeys?: string[]; // giới hạn cột nào có dropdown lọc; bỏ trống = tất cả
  rates?: { entityType: string; fields: string[] }; // field có versioning trong 'rates' — sửa ở CRUD sẽ ghi thêm phiên bản hiệu lực hôm nay
}

const TYPE_OPTS = [
  { value: 'CPM', labelKey: 'type.cpm' },
  { value: 'CPC', labelKey: 'type.cpc' },
  { value: 'CPA', labelKey: 'type.cpa' },
  { value: 'CPS', labelKey: 'type.cps' },
];

// CPM/CPC/CPA → nhãn "Đơn giá"; CPS → "Tỷ lệ"
const PRICE_DYN_LABEL = {
  watch: 'type',
  map: { CPM: 'col.priceOnly', CPC: 'col.priceOnly', CPA: 'col.priceOnly', CPS: 'col.ratioOnly' },
  default: 'col.unitPrice',
};

const orderNamesOf = (advId: number) =>
  getAll('adOrders').filter((o) => o.advertiserId === advId).map((o) => o.name);

const mediaOrderNamesOf = (mediaId: number) =>
  getAll('mediaOrders').filter((o) => o.mediaId === mediaId).map((o) => o.name);

export const SCREENS: Record<string, ScreenConfig> = {
  g1a: {
    screen: 'g1a', collection: 'advertisers', titleKey: 'menu.g1a', uniqueKeys: ['name'],
    filterKeys: ['orders', 'status'],
    columns: [
      { key: 'name', labelKey: 'col.advertiser', sortable: true },
      { key: 'orders', labelKey: 'col.orders', type: 'tags', sortable: true, compute: (r) => orderNamesOf(r.id) },
      { key: 'contact', labelKey: 'col.contact' },
      { key: 'phone', labelKey: 'col.phone' },
      { key: 'email', labelKey: 'col.email' },
      { key: 'note', labelKey: 'col.note' },
    ],
    fields: [
      { key: 'name', labelKey: 'col.advertiser', type: 'text', required: true },
      { key: 'phone', labelKey: 'col.phone', type: 'text', required: true, digitsOnly: true },
      { key: 'contact', labelKey: 'col.contact', type: 'text', required: true },
      { key: 'email', labelKey: 'col.email', type: 'email' },
      { key: 'note', labelKey: 'col.note', type: 'textarea' },
    ],
  },
  g1b: {
    screen: 'g1b', collection: 'adOrders', titleKey: 'menu.g1b', uniqueKeys: ['advertiserId', 'name'],
    filterKeys: ['advertiserId', 'status'],
    columns: [
      { key: 'advertiserId', labelKey: 'col.advertiser', ref: { collection: 'advertisers' }, sortable: true },
      { key: 'name', labelKey: 'col.adOrder', sortable: true },
      { key: 'linkCount', labelKey: 'col.linkCount', align: 'center', compute: (r) => getAll('adIds').filter((a) => a.adOrderId === r.id).length },
      { key: 'note', labelKey: 'col.note' },
    ],
    filters: [{ key: 'advertiserId', labelKey: 'col.advertiser', from: 'advertisers' }],
    fields: [
      { key: 'advertiserId', labelKey: 'col.advertiser', type: 'select', required: true, optionsFrom: 'advertisers', sortActiveOptions: true },
      { key: 'name', labelKey: 'col.adOrder', type: 'text', required: true },
      { key: 'note', labelKey: 'col.note', type: 'textarea' },
    ],
  },
  g1c: {
    screen: 'g1c', collection: 'adIds', titleKey: 'menu.g1c', uniqueKeys: ['name'],
    filterKeys: ['advertiserId', 'adOrderId', 'name', 'type', 'unitPrice', 'status'],
    rates: { entityType: 'adId', fields: ['unitPrice'] },
    columns: [
      { key: 'advertiserId', labelKey: 'col.advertiser', ref: { collection: 'advertisers' }, sortable: true },
      { key: 'adOrderId', labelKey: 'col.adOrder', ref: { collection: 'adOrders' }, sortable: true },
      { key: 'name', labelKey: 'col.adId', sortable: true },
      { key: 'type', labelKey: 'col.type', type: 'badge' },
      { key: 'unitPrice', labelKey: 'col.unitPrice', align: 'right', compute: (r) => effToday('adId', r, 'unitPrice') },
      { key: 'note', labelKey: 'col.note' },
    ],
    filters: [{ key: 'advertiserId', labelKey: 'col.advertiser', from: 'advertisers' }],
    fields: [
      { key: 'advertiserId', labelKey: 'col.advertiser', type: 'select', required: true, optionsFrom: 'advertisers', sortActiveOptions: true },
      { key: 'adOrderId', labelKey: 'col.adOrder', type: 'select', required: true, optionsFrom: 'adOrders', filterBy: { field: 'advertiserId', parentKey: 'advertiserId' }, sortActiveOptions: true },
      { key: 'name', labelKey: 'col.adId', type: 'text', required: true },
      { key: 'type', labelKey: 'col.type', type: 'select', required: true, options: TYPE_OPTS },
      { key: 'unitPrice', labelKey: 'col.unitPrice', type: 'number', step: 0.01, default: 0, dynLabel: PRICE_DYN_LABEL },
      { key: 'note', labelKey: 'col.note', type: 'textarea' },
    ],
  },
  g2a: {
    screen: 'g2a', collection: 'media', titleKey: 'menu.g2a', uniqueKeys: ['name'],
    filterKeys: ['mediaOrders', 'status'],
    columns: [
      { key: 'name', labelKey: 'col.media', sortable: true },
      { key: 'mediaOrders', labelKey: 'col.mediaOrder', type: 'tags', sortable: true, compute: (r) => mediaOrderNamesOf(r.id) },
      { key: 'contact', labelKey: 'col.contact' },
      { key: 'phone', labelKey: 'col.phone' },
      { key: 'email', labelKey: 'col.email' },
      { key: 'note', labelKey: 'col.note' },
    ],
    fields: [
      { key: 'name', labelKey: 'col.media', type: 'text', required: true },
      { key: 'phone', labelKey: 'col.phone', type: 'text', required: true, digitsOnly: true },
      { key: 'contact', labelKey: 'col.contact', type: 'text', required: true },
      { key: 'email', labelKey: 'col.email', type: 'email' },
      { key: 'note', labelKey: 'col.note', type: 'textarea' },
    ],
  },
  g2b: {
    screen: 'g2b', collection: 'mediaOrders', titleKey: 'menu.g2b', uniqueKeys: ['mediaId', 'name'],
    filterKeys: ['mediaId', 'status'],
    columns: [
      { key: 'mediaId', labelKey: 'col.media', ref: { collection: 'media' }, sortable: true },
      { key: 'name', labelKey: 'col.mediaOrder', sortable: true },
      { key: 'quantity', labelKey: 'col.quantity', align: 'center', compute: (r) => getAll('mediaIds').filter((m) => m.mediaOrderId === r.id).length },
      { key: 'note', labelKey: 'col.note' },
    ],
    filters: [{ key: 'mediaId', labelKey: 'col.media', from: 'media' }],
    fields: [
      { key: 'mediaId', labelKey: 'col.media', type: 'select', required: true, optionsFrom: 'media', sortActiveOptions: true },
      { key: 'name', labelKey: 'col.mediaOrder', type: 'text', required: true },
      { key: 'note', labelKey: 'col.note', type: 'textarea' },
    ],
  },
  g2c: {
    screen: 'g2c', collection: 'mediaIds', titleKey: 'menu.g2c', uniqueKeys: ['name'],
    filterKeys: ['advertiserId', 'adOrderId', 'adIdId', 'mediaId', 'mediaOrderId', 'name', 'status'],
    rates: { entityType: 'mediaId', fields: ['unitPrice', 'profitShare'] },
    columns: [
      { key: 'mediaId', labelKey: 'col.media', ref: { collection: 'media' }, sortable: true },
      { key: 'mediaOrderId', labelKey: 'col.mediaOrder', ref: { collection: 'mediaOrders' }, sortable: true },
      { key: 'name', labelKey: 'col.mediaId', sortable: true },
      { key: 'advertiserId', labelKey: 'col.advertiser', ref: { collection: 'advertisers' } },
      { key: 'adOrderId', labelKey: 'col.adOrder', ref: { collection: 'adOrders' } },
      { key: 'adIdId', labelKey: 'col.adId', ref: { collection: 'adIds' } },
      { key: 'type', labelKey: 'col.type', type: 'badge' },
      { key: 'unitPrice', labelKey: 'col.unitPrice', align: 'right', compute: (r) => effToday('mediaId', r, 'unitPrice') },
      { key: 'profitShare', labelKey: 'col.accountShare', type: 'percent', align: 'center', compute: (r) => effToday('mediaId', r, 'profitShare') },
      { key: 'note', labelKey: 'col.note' },
    ],
    filters: [
      { key: 'advertiserId', labelKey: 'col.advertiser', from: 'advertisers' },
      { key: 'mediaId', labelKey: 'col.media', from: 'media' },
    ],
    fields: [
      { key: 'advertiserId', labelKey: 'col.advertiser', type: 'select', required: true, optionsFrom: 'advertisers', sortActiveOptions: true },
      { key: 'adOrderId', labelKey: 'col.adOrder', type: 'select', required: true, optionsFrom: 'adOrders', filterBy: { field: 'advertiserId', parentKey: 'advertiserId' }, sortActiveOptions: true },
      { key: 'adIdId', labelKey: 'col.adId', type: 'select', required: true, optionsFrom: 'adIds', filterBy: { field: 'adOrderId', parentKey: 'adOrderId' }, sortActiveOptions: true, usedOnce: { collection: 'mediaIds', field: 'adIdId' } },
      { key: 'mediaId', labelKey: 'col.media', type: 'select', required: true, optionsFrom: 'media', sortActiveOptions: true },
      { key: 'mediaOrderId', labelKey: 'col.mediaOrder', type: 'select', required: true, optionsFrom: 'mediaOrders', filterBy: { field: 'mediaId', parentKey: 'mediaId' }, sortActiveOptions: true },
      { key: 'name', labelKey: 'col.mediaId', type: 'text', required: true },
      { key: 'type', labelKey: 'col.type', type: 'select', required: true, options: TYPE_OPTS, derive: { watch: 'adIdId', from: 'adIds', source: 'type' }, hidden: true },
      { key: 'unitPrice', labelKey: 'col.unitPrice', type: 'number', step: 0.01, default: 0, dynLabel: PRICE_DYN_LABEL },
      { key: 'profitShare', labelKey: 'col.accountShare', type: 'percent', required: true, default: 80 },
      { key: 'note', labelKey: 'col.note', type: 'textarea' },
    ],
  },
  g7a: {
    screen: 'g7a', collection: 'users', titleKey: 'menu.g7a', uniqueKeys: ['username'],
    columns: [
      { key: 'username', labelKey: 'col.username', sortable: true },
      { key: 'fullName', labelKey: 'col.fullName' },
      { key: 'email', labelKey: 'col.email' },
      { key: 'role', labelKey: 'col.roleName', type: 'badge' },
    ],
    fields: [
      { key: 'username', labelKey: 'col.username', type: 'text', required: true },
      // Password: bắt buộc khi tạo; khi sửa, bỏ trống = giữ nguyên.
      { key: 'password', labelKey: 'common.password', type: 'password', required: true, skipRequiredOnEdit: true, placeholderKey: 'common.passwordPlaceholder' },
      { key: 'fullName', labelKey: 'col.fullName', type: 'text' },
      { key: 'email', labelKey: 'col.email', type: 'email' },
      { key: 'role', labelKey: 'col.roleName', type: 'select', required: true, optionsFrom: 'roles', optionValue: 'name', optionLabel: 'name' },
    ],
  },
};
