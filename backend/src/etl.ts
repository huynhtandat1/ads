import 'dotenv/config';
import pg from 'pg';
import { seedData, type DB, type Row } from './seed.js';

const { Pool } = pg;

// Target = app DB (DATABASE_URL, e.g. "quan"). Source = restored production dump.
const TARGET = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/krakenocean';
const SOURCE_DB = process.env.SOURCE_DB || 'ads_management';
const sourceUrl = (() => { const u = new URL(TARGET); u.pathname = '/' + SOURCE_DB; return u.toString(); })();

const num = (v: unknown) => Number(v ?? 0);
const bool = (s: unknown) => String(s).toLowerCase() === 'active' || String(s).toLowerCase() === 'confirmed';

// Số tiền phải thu tính lại theo loại (đồng bộ với frontend/src/lib/billing.ts và seed.ts):
//  CPM = giá×cơ sở/1000 (cost per mille) · CPC/CPA = giá×cơ sở · CPS = cơ sở×giá(%).
//  KHÔNG lấy revenue có sẵn của DB nguồn vì nguồn có thể đã có /1000 hoặc chưa
//  → tính lại từ đầu cho nhất quán.
function receivableOf(type: string | undefined, price: number, base: number): number {
  if (!price || !base) return 0;
  if (type === 'CPS') return (base * price) / 100;
  if (type === 'CPM') return (price * base) / 1000;
  return price * base;
}

async function main() {
  const src = new Pool({ connectionString: sourceUrl });
  const tgt = new Pool({ connectionString: TARGET });

  const get = async (sql: string) => (await src.query(sql)).rows as any[];

  const upstreams = await get('SELECT id,name,contact,phone,email,notes,status FROM "Upstream"');
  const adOrders = await get('SELECT id,"upstreamId",name,notes,status FROM "AdOrder"');
  const adSites = await get('SELECT id,"upstreamId","adOrderId",name,"billingMethod","currentUnitPrice","rebateRate",status FROM "AdSite"');
  const downstreams = await get('SELECT id,"downstreamType","payoutRate",status FROM "Downstream"');
  const asd = await get('SELECT id,"adSiteId","downstreamId","customPrice" FROM "AdSiteDownstream"');
  const daily = await get(`SELECT id,to_char("recordDate",'YYYY-MM-DD') d,"adSiteId",qty,"unitPriceSnapshot",amount1,"rebateAmount",revenue,status FROM "DailyInput"`);
  const yiyiData = await get(`SELECT id,to_char("recordDate",'YYYY-MM-DD') d,channel,qty FROM "YiyiDailyData"`);
  const yiyiPrice = await get(`SELECT to_char("recordDate",'YYYY-MM-DD') d,"unitPrice","profitUnitPrice" FROM "YiyiDailyPricing"`);
  const logs = await get(`SELECT id,to_char("createdAt",'YYYY-MM-DD HH24:MI:SS') t,username,action,module,"targetType","targetId",detail FROM "OperationLog"`);

  const adSiteById = new Map(adSites.map((a) => [a.id, a]));
  const downById = new Map(downstreams.map((d) => [d.id, d]));
  const priceByDate = new Map(yiyiPrice.map((p) => [p.d, p]));
  const linkByAdSite = new Map(asd.map((l) => [l.adSiteId, l]));

  const db: DB = {};

  db.advertisers = upstreams.map((u) => ({
    id: u.id, name: u.name, contact: u.contact ?? '', phone: u.phone ?? '', email: u.email ?? '',
    note: u.notes ?? '', status: bool(u.status),
  }));

  db.adOrders = adOrders.map((o) => ({
    id: o.id, advertiserId: o.upstreamId, name: o.name,
    linkCount: adSites.filter((a) => a.adOrderId === o.id).length, note: o.notes ?? '', status: bool(o.status),
  }));

  db.adIds = adSites.map((a) => ({
    id: a.id, advertiserId: a.upstreamId, adOrderId: a.adOrderId, name: a.name,
    type: a.billingMethod, unitPrice: num(a.currentUnitPrice), note: '', status: bool(a.status),
  }));

  db.media = downstreams.map((d) => ({
    id: d.id, name: `${d.downstreamType}-${d.id}`, contact: '', phone: '', email: '',
    note: `payout ${num(d.payoutRate) * 100}%`, status: bool(d.status),
  }));

  db.mediaOrders = []; // không có khái niệm tương ứng trong schema thật

  db.mediaIds = asd.map((l) => {
    const site = adSiteById.get(l.adSiteId);
    const down = downById.get(l.downstreamId);
    return {
      id: l.id, advertiserId: site?.upstreamId, adOrderId: site?.adOrderId, adIdId: l.adSiteId,
      mediaId: l.downstreamId, mediaOrderId: null, name: `MID_${l.id}`,
      profitShare: Math.round(num(down?.payoutRate) * 100), unitPrice: num(l.customPrice), note: '', status: true,
    };
  });

  db.importAdv = daily.map((r) => {
    const site = adSiteById.get(r.adSiteId);
    const base = num(r.amount1) || num(r.qty); // quyết toán, rớt về lưu lượng
    const receivable = Math.round(receivableOf(site?.billingMethod, num(r.unitPriceSnapshot), base));
    // Giữ TỶ LỆ rebate của nguồn (rebateAmount/revenue) nhưng áp lên receivable đã tính đúng thang.
    const rebateRate = num(r.revenue) ? num(r.rebateAmount) / num(r.revenue) : 0;
    return {
      id: r.id, date: r.d, objectId: site?.name ?? String(r.adSiteId), adIdId: r.adSiteId,
      advertiserId: site?.upstreamId, adOrderId: site?.adOrderId, type: site?.billingMethod,
      unitPrice: num(r.unitPriceSnapshot), traffic: num(r.qty), settlement: num(r.amount1),
      receivable, revenue: receivable, cost: Math.round(receivable * rebateRate),
      clicks: num(r.qty), source: 'Advertiser', status: bool(r.status),
    };
  });

  // Media daily — derive from DailyInput of ad-sites that have a downstream link.
  db.importMedia = daily.filter((r) => linkByAdSite.has(r.adSiteId)).map((r) => {
    const site = adSiteById.get(r.adSiteId);
    const link = linkByAdSite.get(r.adSiteId);
    const down = downById.get(link.downstreamId);
    const base = num(r.amount1) || num(r.qty);
    const receivable = Math.round(receivableOf(site?.billingMethod, num(r.unitPriceSnapshot), base));
    const shareRate = Math.round(num(down?.payoutRate) * 100);
    const actual = Math.round(receivable * (shareRate / 100));
    return {
      id: r.id, date: r.d, objectId: `MID_${link.id}`, mediaIdId: link.id, mediaId: link.downstreamId,
      mediaOrderId: null, adIdId: r.adSiteId, advertiserId: site?.upstreamId, adOrderId: site?.adOrderId, type: site?.billingMethod,
      unitPrice: num(r.unitPriceSnapshot), traffic: num(r.qty), settlement: num(r.amount1), coefficient: 1,
      receivable, shareRate, actual, revenue: receivable, cost: actual, clicks: num(r.qty),
      source: 'Media', status: bool(r.status),
    };
  });

  db.importAI = [];

  db.importYiyi = yiyiData.map((y) => {
    const p = priceByDate.get(y.d);
    const unitPrice = num(p?.unitPrice), profitUnitPrice = num(p?.profitUnitPrice), q = num(y.qty);
    // Đơn giá Yiyi là giá trên 1.000 lượt (như CPM), giữ 2 số lẻ.
    const payable = Math.round((q * unitPrice) / 10) / 100, profit = Math.round((q * profitUnitPrice) / 10) / 100;
    return {
      id: y.id, date: y.d, objectId: y.channel, quantity: q, unitPrice, profitUnitPrice,
      payable, profit, revenue: payable + profit, cost: payable, clicks: q, source: 'Yiyi', status: true,
    };
  });

  db.logs = logs.map((l) => ({
    id: l.id, time: l.t, user: l.username ?? '-', action: l.action ?? '-',
    object: [l.module, l.targetType, l.targetId].filter(Boolean).join(' / ') || '-',
    ip: '-', detail: l.detail ?? '—', status: true,
  }));

  // Keep app demo accounts / roles / settlements (real users have hashed passwords).
  const seed = seedData();
  db.users = seed.users;
  db.roles = seed.roles;
  db.settleAdv = seed.settleAdv;
  db.settleMedia = seed.settleMedia;

  // Write into target entities table.
  const client = await tgt.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TABLE IF NOT EXISTS entities (collection text NOT NULL, id integer NOT NULL, data jsonb NOT NULL, seq bigserial, PRIMARY KEY (collection,id))');
    await client.query('TRUNCATE entities RESTART IDENTITY');
    let total = 0;
    for (const [collection, list] of Object.entries(db)) {
      for (const row of [...list].reverse()) {
        await client.query('INSERT INTO entities (collection,id,data) VALUES ($1,$2,$3)', [collection, (row as Row).id, row]);
        total++;
      }
    }
    await client.query('COMMIT');
    console.log('[etl] imported collections:');
    for (const [c, l] of Object.entries(db)) console.log(`   ${c} = ${l.length}`);
    console.log(`[etl] total ${total} rows -> ${new URL(TARGET).pathname.slice(1)}`);
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
  await src.end(); await tgt.end();
}

main().catch((e) => { console.error('[etl] failed:', e.message); process.exit(1); });
