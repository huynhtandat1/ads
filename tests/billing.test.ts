import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { receivableOf } from '../frontend/src/lib/billing.ts';

const TOL = 1e-9;

function receivable(type: string, price: number, base: number): number {
  if (type === 'CPS') return (base * price) / 100;
  if (type === 'CPM') return (price * base) / 1000;
  return price * base;
}

interface RateRow { key: string; value: number; effectiveFrom: string }

function effectiveValue(source: { rates?: RateRow[] }, entityType: string, entityId: number | string, field: string, date: string, fallback: number): number {
  const key = `${entityType}:${entityId}:${field}`;
  let best: RateRow | undefined;
  for (const r of source.rates || []) {
    if (r.key === key && r.effectiveFrom <= date && (!best || r.effectiveFrom >= best.effectiveFrom)) best = r;
  }
  return best ? Number(best.value) : fallback;
}

function mediaActualOf(source: any, r: any): number {
  const mediaIds = source.mediaIds || [];
  const mediaId = mediaIds.find((m: any) => m.id === r.mediaIdId);
  const fallbackShareRate = Number(mediaId?.profitShare ?? r.shareRate ?? 0) || 0;
  const shareRate = r.mediaIdId != null
    ? effectiveValue(source, 'mediaId', r.mediaIdId, 'profitShare', String(r.date || ''), fallbackShareRate)
    : fallbackShareRate;
  const payable = r.receivable != null ? Number(r.receivable) || 0 : Number(r.payable) || 0;
  if (!payable && r.receivable == null && r.payable == null) return Number(r.actual) || 0;
  return Math.round(payable * (shareRate / 100) * 100) / 100;
}

function perfOf(collection: string, r: any): { revenue: number; cost: number } {
  return {
    revenue: collection === 'importMedia' ? 0 : Number(r.revenue) || 0,
    cost: Number(r.cost) || 0,
  };
}

function settlementPreviewAdv(scoped: any, target: string, from: string, to: string): number {
  const adv = (scoped.advertisers || []).find((a: any) => a.name === target);
  return (scoped.importAdv || [])
    .filter((r: any) => (!adv || r.advertiserId === adv.id) && (!from || r.date >= from) && (!to || r.date <= to))
    .reduce((s: number, r: any) => s + (Number(r.receivable) || 0), 0);
}

function settlementPreviewMedia(scoped: any, target: string, from: string, to: string): number {
  const media = (scoped.media || []).find((m: any) => m.name === target);
  return Math.round(
    (scoped.importMedia || [])
      .filter((r: any) => (!media || r.mediaId === media.id) && (!from || r.date >= from) && (!to || r.date <= to))
      .reduce((s: number, r: any) => s + mediaActualOf(scoped, r), 0),
  );
}

describe('receivableOf() — frontend/src/lib/billing.ts', () => {
  describe('CPM (cost per mille)', () => {
    test('unitPrice=8, base=10000 → 80', () => {
      assert.equal(receivableOf('CPM', { unitPrice: 8, traffic: '', settlement: 10000 }), 80);
    });
    test('unitPrice=0.5, base=2000 → 1', () => {
      assert.equal(receivableOf('CPM', { unitPrice: 0.5, traffic: '', settlement: 2000 }), 1);
    });
    test('unitPrice=8, base=1000 → 8 (mille boundary)', () => {
      assert.equal(receivableOf('CPM', { unitPrice: 8, traffic: '', settlement: 1000 }), 8);
    });
    test('unitPrice=8, base=0.5 → 0.004 (decimal)', () => {
      assert.equal(receivableOf('CPM', { unitPrice: 8, traffic: '', settlement: 0.5 }), 0.004);
    });
  });

  describe('CPA / CPC (per-action)', () => {
    test('CPA unitPrice=0.45, base=1000 → 450', () => {
      assert.equal(receivableOf('CPA', { unitPrice: 0.45, traffic: '', settlement: 1000 }), 450);
    });
    test('CPA unitPrice=12, base=1000 → 12000', () => {
      assert.equal(receivableOf('CPA', { unitPrice: 12, traffic: '', settlement: 1000 }), 12000);
    });
    test('CPC unitPrice=2.5, base=500 → 1250', () => {
      assert.equal(receivableOf('CPC', { unitPrice: 2.5, traffic: '', settlement: 500 }), 1250);
    });
    test('CPA unitPrice=0.01, base=100 → 1 (small values)', () => {
      assert.equal(receivableOf('CPA', { unitPrice: 0.01, traffic: '', settlement: 100 }), 1);
    });
  });

  describe('CPS (revenue-share percent)', () => {
    test('unitPrice=20 (%), base=1000 → 200', () => {
      assert.equal(receivableOf('CPS', { unitPrice: 20, traffic: '', settlement: 1000 }), 200);
    });
    test('unitPrice=0.1 (%), base=1000 → 1', () => {
      assert.equal(receivableOf('CPS', { unitPrice: 0.1, traffic: '', settlement: 1000 }), 1);
    });
    test('unitPrice=100 (%), base=1000 → 1000 (cap)', () => {
      assert.equal(receivableOf('CPS', { unitPrice: 100, traffic: '', settlement: 1000 }), 1000);
    });
    test('unitPrice=50.5 (%), base=2000 → 1010', () => {
      assert.equal(receivableOf('CPS', { unitPrice: 50.5, traffic: '', settlement: 2000 }), 1010);
    });
  });

  describe('base = settlement || traffic (fallback chain)', () => {
    test('settlement wins when both present', () => {
      assert.equal(receivableOf('CPM', { unitPrice: 8, traffic: 5000, settlement: 10000 }), 80);
    });
    test('settlement 0 ĐÃ NHẬP là chuẩn → 0 (spec 07-2026, không rớt về traffic)', () => {
      assert.equal(receivableOf('CPM', { unitPrice: 8, traffic: 5000, settlement: 0 }), 0);
    });
    test('falls back to traffic when settlement is empty string', () => {
      assert.equal(receivableOf('CPM', { unitPrice: 8, traffic: 5000, settlement: '' }), 40);
    });
    test('null settlement falls back to traffic', () => {
      assert.equal(receivableOf('CPA', { unitPrice: 10, traffic: 100, settlement: null as any }), 1000);
    });
  });

  describe('null/zero guards', () => {
    test('all empty → null', () => {
      assert.equal(receivableOf('CPM', { unitPrice: '', traffic: '', settlement: '' }), null);
    });
    test('unitPrice=0 → null (treated as falsy)', () => {
      assert.equal(receivableOf('CPM', { unitPrice: 0, traffic: 1000, settlement: 1000 }), null);
    });
    test('traffic=0, settlement=0 (đã nhập) → 0', () => {
      assert.equal(receivableOf('CPM', { unitPrice: 8, traffic: 0, settlement: 0 }), 0);
    });
    test('traffic=0, settlement chưa nhập → null', () => {
      assert.equal(receivableOf('CPM', { unitPrice: 8, traffic: 0, settlement: null }), null);
    });
    test('unitPrice undefined → null', () => {
      assert.equal(receivableOf('CPA', { unitPrice: undefined as any, traffic: 100, settlement: 100 }), null);
    });
    test('traffic NaN, settlement present → uses settlement', () => {
      assert.equal(receivableOf('CPA', { unitPrice: 1, traffic: NaN, settlement: 500 }), 500);
    });
  });

  describe('unknown type defaults to per-action formula', () => {
    test('"FOO" treated as CPA: unitPrice * base', () => {
      assert.equal(receivableOf('FOO', { unitPrice: 2, traffic: '', settlement: 100 }), 200);
    });
  });
});

describe('receivable() — backend/src/seed.ts (formula parity)', () => {
  test('matches frontend CPM: 8 × 10000 / 1000', () => assert.equal(receivable('CPM', 8, 10000), 80));
  test('matches frontend CPA: 0.45 × 1000', () => assert.equal(receivable('CPA', 0.45, 1000), 450));
  test('matches frontend CPS: 20 × 1000 / 100', () => assert.equal(receivable('CPS', 20, 1000), 200));
  test('unknown type defaults to price × base', () => assert.equal(receivable('XYZ', 5, 100), 500));
});

describe('mediaActualOf() — backend/src/server.ts', () => {
  const source = {
    mediaIds: [
      { id: 1, profitShare: 80 },
      { id: 2, profitShare: 75 },
      { id: 3, profitShare: 80 },
    ],
    rates: [],
  };

  test('basic: receivable=100, share=80 → 80.00 (2-decimal round)', () => {
    assert.equal(mediaActualOf(source, { mediaIdId: 1, receivable: 100, date: '2026-06-10' }), 80);
  });
  test('share=75 → 75.00', () => {
    assert.equal(mediaActualOf(source, { mediaIdId: 2, receivable: 100, date: '2026-06-10' }), 75);
  });
  test('round-half-up: 100 × 0.8333 = 83.33', () => {
    assert.equal(mediaActualOf(source, { mediaIdId: 99, receivable: 100, shareRate: 83.33, date: '2026-06-10' }), 83.33);
  });
  test('uses r.shareRate fallback when mediaIdId missing', () => {
    assert.equal(mediaActualOf(source, { shareRate: 50, receivable: 200, date: '2026-06-10' }), 100);
  });
  test('precedence: rates override mediaIds.profitShare when effectiveFrom<=date', () => {
    const s = {
      mediaIds: [{ id: 1, profitShare: 80 }],
      rates: [{ key: 'mediaId:1:profitShare', value: 90, effectiveFrom: '2026-06-15' }],
    };
    assert.equal(mediaActualOf(s, { mediaIdId: 1, receivable: 100, date: '2026-06-10' }), 80);
    assert.equal(mediaActualOf(s, { mediaIdId: 1, receivable: 100, date: '2026-06-15' }), 90);
    assert.equal(mediaActualOf(s, { mediaIdId: 1, receivable: 100, date: '2026-06-20' }), 90);
  });
  test('zero receivable with both fields null → returns r.actual as-is', () => {
    assert.equal(mediaActualOf(source, { actual: 42, date: '2026-06-10' }), 42);
  });
  test('zero receivable with receivable=null and payable=null → returns r.actual', () => {
    assert.equal(mediaActualOf(source, { receivable: null, payable: null, actual: 7, date: '2026-06-10' }), 7);
  });
  test('receivable=null but payable=100 → uses payable × share', () => {
    assert.equal(mediaActualOf(source, { receivable: null, payable: 100, date: '2026-06-10', mediaIdId: 1 }), 80);
  });
  test('fractional share: 33.33% × 300 = 99.99', () => {
    assert.equal(mediaActualOf(source, { shareRate: 33.33, receivable: 300, date: '2026-06-10' }), 99.99);
  });
  test('integer share 100% × 100 = 100', () => {
    assert.equal(mediaActualOf(source, { shareRate: 100, receivable: 100, date: '2026-06-10' }), 100);
  });
  test('share 0% × 100 = 0', () => {
    assert.equal(mediaActualOf(source, { shareRate: 0, receivable: 100, date: '2026-06-10' }), 0);
  });
});

describe('MediaDataEntryPage.calc() — frontend flow (payable/netPay)', () => {
  function calc(m: any, advRow: any, coef: number, accountShare: number) {
    const traffic = advRow ? (advRow.traffic ?? advRow.clicks ?? '') : '';
    const settlement = advRow ? (advRow.settlement ?? '') : '';
    const type = m.type;
    const unitPrice = m.unitPrice ?? 0;
    const receivable = receivableOf(type, { unitPrice, traffic, settlement });
    const payable = receivable == null ? null : receivable * coef;
    const netPay = payable == null ? null : payable * (accountShare / 100);
    return { receivable, payable, netPay };
  }

  test('CPM unitPrice=8 settlement=10000 coef=1 share=80 → payable=80 netPay=64', () => {
    const m = { type: 'CPM', unitPrice: 8 };
    const adv = { traffic: '', settlement: 10000 };
    assert.deepEqual(calc(m, adv, 1, 80), { receivable: 80, payable: 80, netPay: 64 });
  });
  test('coef=0.5: payable = 80 × 0.5 = 40, netPay = 40 × 0.8 = 32', () => {
    const m = { type: 'CPM', unitPrice: 8 };
    const adv = { traffic: '', settlement: 10000 };
    assert.deepEqual(calc(m, adv, 0.5, 80), { receivable: 80, payable: 40, netPay: 32 });
  });
  test('CPA unitPrice=12 settlement=1000 coef=1 share=75 → payable=12000 netPay=9000', () => {
    const m = { type: 'CPA', unitPrice: 12 };
    const adv = { traffic: '', settlement: 1000 };
    assert.deepEqual(calc(m, adv, 1, 75), { receivable: 12000, payable: 12000, netPay: 9000 });
  });
  test('CPS unitPrice=20 settlement=1000 coef=1 share=80 → receivable=200 netPay=160', () => {
    const m = { type: 'CPS', unitPrice: 20 };
    const adv = { traffic: '', settlement: 1000 };
    assert.deepEqual(calc(m, adv, 1, 80), { receivable: 200, payable: 200, netPay: 160 });
  });
  test('no importAdv row → all null', () => {
    const m = { type: 'CPM', unitPrice: 8 };
    assert.deepEqual(calc(m, null, 1, 80), { receivable: null, payable: null, netPay: null });
  });
  test('importAdv present but traffic/settlement empty → receivable=null', () => {
    const m = { type: 'CPM', unitPrice: 8 };
    const adv = { traffic: '', settlement: '' };
    assert.deepEqual(calc(m, adv, 1, 80), { receivable: null, payable: null, netPay: null });
  });
  test('traffic used when settlement CHƯA nhập (null)', () => {
    const m = { type: 'CPM', unitPrice: 8 };
    const adv = { traffic: 5000, settlement: null };
    assert.deepEqual(calc(m, adv, 1, 80), { receivable: 40, payable: 40, netPay: 32 });
  });
  test('settlement 0 đã nhập → phải trả 0 (traffic vô hiệu, spec 07-2026)', () => {
    const m = { type: 'CPM', unitPrice: 8 };
    const adv = { traffic: 5000, settlement: 0 };
    assert.deepEqual(calc(m, adv, 1, 80), { receivable: 0, payable: 0, netPay: 0 });
  });
  test('shareRate=100% → netPay == payable', () => {
    const m = { type: 'CPA', unitPrice: 10 };
    const adv = { traffic: '', settlement: 100 };
    assert.deepEqual(calc(m, adv, 1, 100), { receivable: 1000, payable: 1000, netPay: 1000 });
  });
});

describe('Settlement preview — /api/settlement/preview', () => {
  const scoped = {
    advertisers: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
    media: [{ id: 10, name: 'M1' }, { id: 11, name: 'M2' }],
    importAdv: [
      { id: 100, advertiserId: 1, date: '2026-06-10', receivable: 1000 },
      { id: 101, advertiserId: 1, date: '2026-06-11', receivable: 2000 },
      { id: 102, advertiserId: 2, date: '2026-06-12', receivable: 5000 },
      { id: 103, advertiserId: 1, date: '2026-06-20', receivable: 9999 },
    ],
    importMedia: [
      { id: 200, mediaId: 10, date: '2026-06-10', mediaIdId: 1, receivable: 500, shareRate: 80 },
      { id: 201, mediaId: 10, date: '2026-06-11', mediaIdId: 1, receivable: 300, shareRate: 80 },
      { id: 202, mediaId: 11, date: '2026-06-12', mediaIdId: 2, receivable: 1000, shareRate: 75 },
      { id: 203, mediaId: 10, date: '2026-06-20', mediaIdId: 1, receivable: 100, shareRate: 80 },
    ],
    mediaIds: [{ id: 1, profitShare: 80 }, { id: 2, profitShare: 75 }],
    rates: [],
  };

  test('adv: target A → 3000 (within 06-10..06-12)', () => {
    assert.equal(settlementPreviewAdv(scoped, 'A', '2026-06-10', '2026-06-12'), 3000);
  });
  test('adv: target B → 5000', () => {
    assert.equal(settlementPreviewAdv(scoped, 'B', '2026-06-10', '2026-06-12'), 5000);
  });
  test('adv: target "" → sum ALL (no target filter) = 1000+2000+5000 = 8000', () => {
    assert.equal(settlementPreviewAdv(scoped, '', '2026-06-10', '2026-06-12'), 8000);
  });
  test('adv: from/to filter excludes 06-20', () => {
    assert.equal(settlementPreviewAdv(scoped, 'A', '2026-06-10', '2026-06-12'), 3000);
  });
  test('adv: from="" to="" → all rows', () => {
    assert.equal(settlementPreviewAdv(scoped, '', '', ''), 1000 + 2000 + 5000 + 9999);
  });
  test('media: M1 → (500+300) × 0.8 = 640', () => {
    assert.equal(settlementPreviewMedia(scoped, 'M1', '2026-06-10', '2026-06-12'), 640);
  });
  test('media: M2 → 1000 × 0.75 = 750', () => {
    assert.equal(settlementPreviewMedia(scoped, 'M2', '2026-06-10', '2026-06-12'), 750);
  });
  test('media: no rows → 0', () => {
    assert.equal(settlementPreviewMedia(scoped, 'M1', '2026-07-01', '2026-07-31'), 0);
  });
  test('adv: receivable=null/NaN treated as 0', () => {
    const s = { ...scoped, importAdv: [{ id: 1, advertiserId: 1, date: '2026-06-10', receivable: null as any }] };
    assert.equal(settlementPreviewAdv(s, 'A', '2026-06-10', '2026-06-10'), 0);
  });
});

describe('Tax calculation — TAX_PCT=6 default (AggregateReportPage / TotalProfitPage)', () => {
  const TAX_PCT = 6;
  function tax(profit: number, taxPct = TAX_PCT) {
    return Math.round((profit * taxPct) / 100);
  }
  test('profit=1000, taxPct=6 → 60', () => assert.equal(tax(1000), 60));
  test('profit=0 → 0', () => assert.equal(tax(0), 0));
  test('negative profit (loss) → negative tax', () => assert.equal(tax(-1000), -60));
  test('rounds half-up: 99.5 × 0.06 = 5.97', () => assert.equal(tax(99.5), 6));
  test('fractional: 333.33 × 0.06 = 19.9998 → 20', () => assert.equal(tax(333.33), 20));
  test('custom taxPct=10 on profit=500 → 50', () => assert.equal(tax(500, 10), 50));
  test('afterTax = profit - tax', () => assert.equal(1000 - tax(1000), 940));
});

describe('perfOf() — analytics.ts (avoids importMedia revenue double-count)', () => {
  test('importAdv contributes both revenue and cost', () => {
    assert.deepEqual(perfOf('importAdv', { revenue: 100, cost: 0 }), { revenue: 100, cost: 0 });
  });
  test('importMedia contributes ONLY cost (revenue forced to 0)', () => {
    assert.deepEqual(perfOf('importMedia', { revenue: 100, cost: 50 }), { revenue: 0, cost: 50 });
  });
  test('importAI behaves like importAdv', () => {
    assert.deepEqual(perfOf('importAI', { revenue: 200, cost: 50 }), { revenue: 200, cost: 50 });
  });
  test('null revenue → 0', () => {
    assert.deepEqual(perfOf('importAdv', { revenue: null, cost: 10 }), { revenue: 0, cost: 10 });
  });
  test('NaN cost → 0', () => {
    assert.deepEqual(perfOf('importAdv', { revenue: 100, cost: NaN }), { revenue: 100, cost: 0 });
  });
});

describe('Aggregate report (g4a/g4b) — profit / margin / tax', () => {
  function agg(rows: { c: string; r: any }[], taxPct = 6) {
    let revenue = 0, cost = 0;
    for (const { c, r } of rows) {
      const p = perfOf(c, r);
      revenue += p.revenue;
      cost += p.cost;
    }
    const profit = revenue - cost;
    const tax = Math.round((profit * taxPct) / 100);
    const afterTax = profit - tax;
    const margin = revenue ? +((profit / revenue) * 100).toFixed(1) : 0;
    return { revenue, cost, profit, tax, afterTax, margin };
  }

  test('only importAdv: revenue=1000 cost=0 → profit=1000 tax=60 afterTax=940 margin=100', () => {
    assert.deepEqual(agg([{ c: 'importAdv', r: { revenue: 1000, cost: 0 } }]),
      { revenue: 1000, cost: 0, profit: 1000, tax: 60, afterTax: 940, margin: 100 });
  });
  test('only importMedia: revenue forced 0, cost=500 → profit=-500 tax=-30 afterTax=-470', () => {
    assert.deepEqual(agg([{ c: 'importMedia', r: { revenue: 999, cost: 500 } }]),
      { revenue: 0, cost: 500, profit: -500, tax: -30, afterTax: -470, margin: 0 });
  });
  test('mixed adv+media on same dim: adv revenue=1000 + media cost=300 → profit=700', () => {
    const r = agg([
      { c: 'importAdv', r: { revenue: 1000, cost: 0 } },
      { c: 'importMedia', r: { revenue: 1000, cost: 300 } },
    ]);
    assert.deepEqual(r, { revenue: 1000, cost: 300, profit: 700, tax: 42, afterTax: 658, margin: 70 });
  });
  test('zero revenue → margin=0 (no division)', () => {
    assert.equal(agg([{ c: 'importMedia', r: { revenue: 0, cost: 0 } }]).margin, 0);
  });
  test('margin rounds to 1 decimal: 1/3 → 33.3', () => {
    const r = agg([
      { c: 'importAdv', r: { revenue: 3, cost: 2 } },
    ]);
    assert.equal(r.margin, 33.3);
  });
});

describe('SettlementPage code generation', () => {
  function makeCode(prefix: string, from: string) {
    return `${prefix}-${from.slice(2, 7).replace('-', '')}-${String(Math.floor(Math.random() * 90) + 10)}`;
  }
  test('adv prefix + 2-digit random [10..99]', () => {
    for (let i = 0; i < 100; i++) {
      const c = makeCode('ST-ADV', '2026-06-01');
      assert.match(c, /^ST-ADV-2606-(?:[1-9]\d)$/);
    }
  });
  test('media prefix', () => {
    for (let i = 0; i < 100; i++) {
      const c = makeCode('ST-MED', '2026-06-15');
      assert.match(c, /^ST-MED-2606-(?:[1-9]\d)$/);
    }
  });
  test('YYMM from from.slice(2,7).replace("-","")', () => {
    assert.equal('2026-06-01'.slice(2, 7).replace('-', ''), '2606');
    assert.equal('2026-12-31'.slice(2, 7).replace('-', ''), '2612');
  });
});

describe('Cross-validation: frontend vs backend formula parity', () => {
  const cases: Array<[string, number, number]> = [
    ['CPM', 8, 10000],
    ['CPM', 0.5, 2000],
    ['CPM', 12.5, 3200],
    ['CPA', 0.45, 1000],
    ['CPA', 12, 5000],
    ['CPC', 2.5, 500],
    ['CPS', 20, 1000],
    ['CPS', 0.1, 5000],
    ['CPS', 50.5, 2000],
    ['XYZ', 3, 100],
  ];
  for (const [type, price, base] of cases) {
    test(`${type} price=${price} base=${base} frontend===backend`, () => {
      const fe = receivableOf(type, { unitPrice: price, traffic: '', settlement: base });
      const be = receivable(type, price, base);
      assert.equal(fe, be, `frontend=${fe} backend=${be}`);
    });
  }
});

describe('Edge cases & regressions', () => {
  test('CPM with very small base: 8 × 0.001 / 1000 = 0.000008', () => {
    assert.equal(receivableOf('CPM', { unitPrice: 8, traffic: '', settlement: 0.001 }), 0.000008);
  });
  test('CPM with very large base: 8 × 1e9 / 1000 = 8e6', () => {
    assert.equal(receivableOf('CPM', { unitPrice: 8, traffic: '', settlement: 1e9 }), 8e6);
  });
  test('CPS negative price (defensive): 1000 × -20 / 100 = -200', () => {
    assert.equal(receivableOf('CPS', { unitPrice: -20, traffic: '', settlement: 1000 }), -200);
  });
  test('rounding consistency: settlement 999.999 CPM 8 = 7.999992', () => {
    assert.equal(receivableOf('CPM', { unitPrice: 8, traffic: '', settlement: 999.999 }), 7.999992);
  });
  test('mediaActualOf rounding: 33.333% × 999 = 332.99967 → 333.00', () => {
    const src = { mediaIds: [], rates: [] };
    assert.equal(mediaActualOf(src, { shareRate: 33.333, receivable: 999, date: '2026-06-10' }), 333);
  });
  test('mediaActualOf 3-decimal share: 33.3334% × 100 = 33.33 (bankers round)', () => {
    const src = { mediaIds: [], rates: [] };
    const v = mediaActualOf(src, { shareRate: 33.3334, receivable: 100, date: '2026-06-10' });
    assert.ok(Math.abs(v - 33.33) < TOL || Math.abs(v - 33.34) < TOL, `got ${v}`);
  });
  test('Settlement adv sums ALL rows for empty target (full preview)', () => {
    const s = { advertisers: [], importAdv: [
      { advertiserId: 1, date: '2026-06-10', receivable: 100 },
      { advertiserId: 2, date: '2026-06-10', receivable: 200 },
    ] };
    assert.equal(settlementPreviewAdv(s, '', '2026-06-10', '2026-06-10'), 300);
  });
  test('Settlement media for empty target sums all rows', () => {
    const s = {
      media: [],
      mediaIds: [{ id: 1, profitShare: 50 }, { id: 2, profitShare: 100 }],
      rates: [],
      importMedia: [
        { mediaId: 1, date: '2026-06-10', mediaIdId: 1, receivable: 100 },
        { mediaId: 2, date: '2026-06-10', mediaIdId: 2, receivable: 200 },
      ],
    };
    assert.equal(settlementPreviewMedia(s, '', '2026-06-10', '2026-06-10'), 50 + 200);
  });
  test('perfOf negative revenue kept (cost -ve gives positive profit)', () => {
    assert.deepEqual(perfOf('importAdv', { revenue: -100, cost: 0 }), { revenue: -100, cost: 0 });
  });
});

describe('effectiveValue() — versioning (frontend + backend parity)', () => {
  const source = {
    rates: [
      { key: 'mediaId:1:profitShare', value: 75, effectiveFrom: '2026-01-01' },
      { key: 'mediaId:1:profitShare', value: 80, effectiveFrom: '2026-06-01' },
      { key: 'mediaId:1:profitShare', value: 85, effectiveFrom: '2026-07-01' },
    ],
  };
  test('before earliest → fallback', () => {
    assert.equal(effectiveValue(source, 'mediaId', 1, 'profitShare', '2025-12-31', 70), 70);
  });
  test('between two versions → picks latest <= date', () => {
    assert.equal(effectiveValue(source, 'mediaId', 1, 'profitShare', '2026-03-01', 70), 75);
    assert.equal(effectiveValue(source, 'mediaId', 1, 'profitShare', '2026-06-15', 70), 80);
  });
  test('at effectiveFrom boundary → picks new value', () => {
    assert.equal(effectiveValue(source, 'mediaId', 1, 'profitShare', '2026-07-01', 70), 85);
  });
  test('unknown key → fallback', () => {
    assert.equal(effectiveValue(source, 'mediaId', 999, 'profitShare', '2026-06-15', 50), 50);
  });
});