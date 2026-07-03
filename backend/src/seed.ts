export type Row = Record<string, any> & { id: number };
export type DB = Record<string, Row[]>;

// Số tiền phải thu (giữ đồng bộ với frontend/src/lib/billing.ts):
//  CPM/CPC/CPA = đơn giá×cơ sở · CPS = cơ sở×đơn giá(%).
function receivable(type: string, price: number, base: number): number {
  if (type === 'CPS') return (base * price) / 100;
  return price * base;
}

const SCREENS = [
  'g1a', 'g1b', 'g1c', 'g2a', 'g2b', 'g2c', 'g3a', 'g3b', 'g3c', 'g3d',
  'g4a', 'g4b', 'g4c', 'g4d', 'g4e', 'g5a', 'g5b', 'g6', 'g7a', 'g7b', 'g7c',
];

// Màn quản trị hệ thống — chỉ SUPER_ADMIN được thao tác, không cấp qua buildPerms
// cho các vai trò thường (tránh operator tự tạo user / sửa vai trò để leo quyền).
const ADMIN_SCREENS = new Set(['g7a', 'g7b', 'g7c']);

function buildPerms(allowed: string[]) {
  const p: Record<string, Record<string, boolean>> = {};
  for (const s of SCREENS) {
    const admin = ADMIN_SCREENS.has(s);
    p[s] = {
      view: !admin && allowed.includes('view'), create: !admin && allowed.includes('create'),
      edit: !admin && allowed.includes('edit'), delete: !admin && allowed.includes('delete'),
      export: !admin && allowed.includes('export'),
    };
  }
  return p;
}

// Advertiser-style data-entry records (also reused for AI source).
function seedEntries(source: string, dates: string[], startId: number): Row[] {
  const ads = [
    { adIdId: 31, advertiserId: 12, adOrderId: 21, name: 'sm_a01', type: 'CPA', unitPrice: 0.45 },
    { adIdId: 30, advertiserId: 12, adOrderId: 20, name: '360_b02', type: 'CPA', unitPrice: 12 },
    { adIdId: 27, advertiserId: 11, adOrderId: 18, name: 'qw_c03', type: 'CPM', unitPrice: 8 },
    { adIdId: 5, advertiserId: 1, adOrderId: 3, name: '360_e05', type: 'CPS', unitPrice: 20 },
  ];
  const rows: Row[] = [];
  let id = startId;
  for (const d of dates) {
    for (const a of ads) {
      const traffic = 800 + Math.floor(Math.random() * 6000);
      const settlement = 1000 + Math.floor(Math.random() * 9000);
      const base = settlement || traffic;
      const amount = Math.round(receivable(a.type, a.unitPrice, base));
      rows.push({
        id: id++, date: d, objectId: a.name, adIdId: a.adIdId, advertiserId: a.advertiserId,
        adOrderId: a.adOrderId, type: a.type, unitPrice: a.unitPrice, traffic, settlement,
        receivable: amount, revenue: amount, cost: settlement, clicks: traffic, source, status: true,
      });
    }
  }
  return rows;
}

function seedMediaEntries(): Row[] {
  const mids = [
    { mediaIdId: 51, mediaId: 14, mediaOrderId: 41, adIdId: 31, advertiserId: 12, name: 'MID_001', type: 'CPA', unitPrice: 0.4, profitShare: 80 },
    { mediaIdId: 50, mediaId: 14, mediaOrderId: 40, adIdId: 30, advertiserId: 12, name: 'MID_002', type: 'CPA', unitPrice: 10, profitShare: 75 },
    { mediaIdId: 47, mediaId: 13, mediaOrderId: 36, adIdId: 27, advertiserId: 11, name: 'MID_003', type: 'CPM', unitPrice: 6.5, profitShare: 80 },
    { mediaIdId: 19, mediaId: 2, mediaOrderId: 16, adIdId: 5, advertiserId: 1, name: 'MID_005', type: 'CPS', unitPrice: 20, profitShare: 80 },
  ];
  const dates = ['2026-06-10', '2026-06-11', '2026-06-12'];
  const rows: Row[] = [];
  let id = 4000;
  for (const d of dates) {
    for (const m of mids) {
      const traffic = 800 + Math.floor(Math.random() * 6000);
      const settlement = 1000 + Math.floor(Math.random() * 9000);
      const coefficient = 1;
      const base = settlement || traffic;
      const amount = Math.round(receivable(m.type, m.unitPrice, base));
      const actual = Math.round(amount * (m.profitShare / 100) * coefficient);
      rows.push({
        id: id++, date: d, objectId: m.name, mediaIdId: m.mediaIdId, mediaId: m.mediaId,
        mediaOrderId: m.mediaOrderId, adIdId: m.adIdId, advertiserId: m.advertiserId, type: m.type,
        unitPrice: m.unitPrice, traffic, settlement, coefficient, receivable: amount, shareRate: m.profitShare,
        actual, revenue: amount, cost: actual, clicks: traffic, source: 'Media', status: true,
      });
    }
  }
  return rows;
}

function seedYiyiEntries(): Row[] {
  const channels = ['yy-02-01', 'yy-02-02', 'yy-02-03', 'yy-02-04'];
  const unitPrice = 0.5, profitUnitPrice = 0.2;
  const rows: Row[] = [];
  let id = 3000;
  for (let day = 1; day <= 20; day++) {
    const date = `2026-06-${String(day).padStart(2, '0')}`;
    for (const c of channels) {
      const q = 200 + Math.floor(Math.random() * 1800);
      const payable = q * unitPrice, profit = q * profitUnitPrice;
      rows.push({
        id: id++, date, objectId: c, quantity: q, unitPrice, profitUnitPrice,
        payable, profit, revenue: payable + profit, cost: payable, clicks: q, source: 'Yiyi', status: true,
      });
    }
  }
  return rows;
}

function seedLogs(): Row[] {
  const actions = ['create', 'edit', 'delete', 'login', 'export'];
  const objs = ['广告主 大白', '广告订单 sm', '媒体 刘佳', '媒体ID MID_001', '用户 operator'];
  const rows: Row[] = [];
  for (let i = 0; i < 12; i++) {
    rows.push({
      id: 5000 + i,
      time: `2026-06-${String(20 + (i % 5)).padStart(2, '0')} ${String(8 + i).padStart(2, '0')}:${String(10 + i).padStart(2, '0')}:00`,
      user: i % 3 === 0 ? 'admin' : 'operator', action: actions[i % actions.length],
      object: objs[i % objs.length], ip: `192.168.1.${10 + i}`, detail: '—', status: true,
    });
  }
  return rows;
}

export function seedData(): DB {
  return {
    advertisers: [
      { id: 12, name: '大白', contact: '王伟', phone: '13800000012', email: 'dabai@adv.com', note: '', status: true },
      { id: 11, name: '懿利', contact: '李娜', phone: '13800000011', email: 'yili@adv.com', note: 'VIP', status: true },
      { id: 10, name: '星汉灿烂', contact: '张敏', phone: '13800000010', email: 'xinghan@adv.com', note: '', status: true },
      { id: 7, name: 'Shengleyou', contact: 'John', phone: '13800000007', email: 'sly@adv.com', note: '', status: false },
      { id: 4, name: '响云', contact: '刘强', phone: '13800000004', email: 'xiangyun@adv.com', note: '', status: true },
      { id: 1, name: '百战', contact: '陈晨', phone: '13800000001', email: 'baizhan@adv.com', note: '', status: true },
    ],
    adOrders: [
      { id: 21, advertiserId: 12, name: 'sm', linkCount: 4, note: '', status: true },
      { id: 20, advertiserId: 12, name: '360', linkCount: 2, note: '', status: true },
      { id: 18, advertiserId: 11, name: 'Qianwen', linkCount: 3, note: '', status: true },
      { id: 15, advertiserId: 10, name: '360_AI', linkCount: 5, note: '', status: true },
      { id: 9, advertiserId: 4, name: 'sm', linkCount: 1, note: '', status: false },
      { id: 3, advertiserId: 1, name: '360', linkCount: 2, note: '', status: true },
    ],
    adIds: [
      { id: 31, advertiserId: 12, adOrderId: 21, name: 'sm_a01', type: 'CPA', unitPrice: 0.45, note: '', status: true },
      { id: 30, advertiserId: 12, adOrderId: 20, name: '360_b02', type: 'CPA', unitPrice: 12, note: '', status: true },
      { id: 27, advertiserId: 11, adOrderId: 18, name: 'qw_c03', type: 'CPM', unitPrice: 8, note: '', status: true },
      { id: 22, advertiserId: 10, adOrderId: 15, name: 'ai_d04', type: 'CPS', unitPrice: 0.1, note: '', status: false },
      { id: 5, advertiserId: 1, adOrderId: 3, name: '360_e05', type: 'CPS', unitPrice: 20, note: '', status: true },
    ],
    media: [
      { id: 14, name: '刘佳', contact: '刘佳', phone: '13900000014', email: 'liujia@media.com', note: '', status: true },
      { id: 13, name: '响云', contact: '赵云', phone: '13900000013', email: 'xy@media.com', note: '', status: true },
      { id: 8, name: '百战', contact: '孙武', phone: '13900000008', email: 'bz@media.com', note: '', status: true },
      { id: 6, name: '罗强', contact: '罗强', phone: '13900000006', email: 'lq@media.com', note: '', status: false },
      { id: 2, name: '懿利', contact: '周瑜', phone: '13900000002', email: 'yl@media.com', note: '', status: true },
    ],
    mediaOrders: [
      { id: 41, mediaId: 14, name: 'mo_sm', quantity: 3, note: '', status: true },
      { id: 40, mediaId: 14, name: 'mo_360', quantity: 2, note: '', status: true },
      { id: 36, mediaId: 13, name: 'mo_qw', quantity: 4, note: '', status: true },
      { id: 29, mediaId: 8, name: 'mo_ai', quantity: 1, note: '', status: true },
      { id: 16, mediaId: 2, name: 'mo_sm2', quantity: 2, note: '', status: false },
    ],
    mediaIds: [
      { id: 51, advertiserId: 12, adOrderId: 21, adIdId: 31, mediaId: 14, mediaOrderId: 41, name: 'MID_001', profitShare: 80, unitPrice: 0.4, note: '', status: true },
      { id: 50, advertiserId: 12, adOrderId: 20, adIdId: 30, mediaId: 14, mediaOrderId: 40, name: 'MID_002', profitShare: 75, unitPrice: 10, note: '', status: true },
      { id: 47, advertiserId: 11, adOrderId: 18, adIdId: 27, mediaId: 13, mediaOrderId: 36, name: 'MID_003', profitShare: 80, unitPrice: 6.5, note: '', status: true },
      { id: 42, advertiserId: 10, adOrderId: 15, adIdId: 22, mediaId: 8, mediaOrderId: 29, name: 'MID_004', profitShare: 85, unitPrice: 0.08, note: '', status: false },
      { id: 19, advertiserId: 1, adOrderId: 3, adIdId: 5, mediaId: 2, mediaOrderId: 16, name: 'MID_005', profitShare: 80, unitPrice: 0.45, note: '', status: true },
    ],
    users: [
      { id: 1, username: 'admin', password: 'admin', fullName: 'Administrator', email: 'admin@krakenocean.com', role: 'SUPER_ADMIN', scope: 'all', status: true },
      { id: 3, username: 'operator', password: '123456', fullName: '操作员', email: 'op@krakenocean.com', role: 'OPERATOR', scope: 'all', status: true },
      { id: 5, username: 'viewer', password: '123456', fullName: '查看员', email: 'view@krakenocean.com', role: 'VIEWER', scope: 'all', status: false },
    ],
    roles: [
      { id: 1, name: 'SUPER_ADMIN', permissions: '*', status: true },
      { id: 2, name: 'OPERATOR', permissions: JSON.stringify(buildPerms(['view', 'create', 'edit', 'export'])), status: true },
      { id: 3, name: 'VIEWER', permissions: JSON.stringify(buildPerms(['view'])), status: true },
    ],
    importAI: seedEntries('AI', ['2026-06-13', '2026-06-14', '2026-06-15'], 6000),
    importAdv: seedEntries('Advertiser', ['2026-06-10', '2026-06-11', '2026-06-12'], 2000),
    importMedia: seedMediaEntries(),
    importYiyi: seedYiyiEntries(),
    logs: seedLogs(),
    settleAdv: [
      { id: 101, code: 'ST-ADV-2406-01', target: '大白', period: '2026-06-01 ~ 2026-06-15', totalAmount: 12500, payStatus: 'unpaid', createdAt: '2026-06-16', status: true },
      { id: 100, code: 'ST-ADV-2406-02', target: '懿利', period: '2026-06-01 ~ 2026-06-15', totalAmount: 8800, payStatus: 'paid', createdAt: '2026-06-16', status: true },
      { id: 97, code: 'ST-ADV-2405-08', target: '星汉灿烂', period: '2026-05-16 ~ 2026-05-31', totalAmount: 15200, payStatus: 'paid', createdAt: '2026-06-01', status: true },
    ],
    settleMedia: [
      { id: 201, code: 'ST-MED-2406-01', target: '刘佳', period: '2026-06-01 ~ 2026-06-15', totalAmount: 9600, payStatus: 'unpaid', createdAt: '2026-06-16', status: true },
      { id: 200, code: 'ST-MED-2406-02', target: '响云', period: '2026-06-01 ~ 2026-06-15', totalAmount: 6400, payStatus: 'paid', createdAt: '2026-06-16', status: true },
    ],
  };
}
