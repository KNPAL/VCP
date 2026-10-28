import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,readInspector,inspectorListings,readPortfolio,persistSource} from '../packages/database/dist/index.js';
import {candlePermission} from '../fixtures/candle-permission.mjs';
import {inspectorFixture} from '../fixtures/inspector.mjs';
const db=new PrismaClient();
test('inspector keeps immutable detector evidence, production curves and owner-scoped records',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const execution=inspectorFixture(randomUUID()),owner=await db.owner.findFirstOrThrow(),before=await readPortfolio(db,owner.id);
  const provider='synthetic-inspector-'+randomUUID(),permission=await candlePermission(db,provider);
  for(const bar of execution.input.series.bars)bar.revision=randomUUID();
  await db.candleRevision.createMany({data:execution.input.series.bars.map(bar=>({id:bar.revision,listingId:execution.input.listingId,session:new Date(bar.session),scale:'RAW',revision:1,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:BigInt(bar.volume),source:provider,receivedAt:new Date(execution.input.decidedAt),finalizedAt:new Date(bar.finalizedAt)}))});
  await db.$executeRaw`INSERT INTO "DailyStructureExecution" ("id","listingId","session","configHash","evidence") VALUES (${execution.id},${execution.input.listingId}::uuid,${new Date(execution.detector.frozen.session)},${execution.input.configHash},${JSON.stringify(execution)}::jsonb)`;
  const listings=await inspectorListings(db);assert.ok(listings.items.some(row=>row.id===execution.id));
  const view=await readInspector(db,owner.id,execution.id);assert.equal(view.executable,false);assert.equal(view.priceScale,'ADJUSTED');assert.equal(view.fillPriceScale,'RAW');assert.deepEqual(view.structure,execution.detector.structure);assert.deepEqual(view.frozen,execution.detector.frozen);assert.equal(view.bars.length,260);assert.equal(view.bars.at(-1).close,execution.input.series.bars.at(-1).close);
  const other=await readInspector(db,randomUUID(),execution.id);assert.deepEqual(other.fills,[]);assert.deepEqual(other.stops,[]);assert.deepEqual(other.trails,[]);assert.deepEqual(other.bars,view.bars);
  assert.equal(await readInspector(db,owner.id,'0'.repeat(64)),null);await assert.rejects(readInspector(db,owner.id,'invalid'));
  assert.deepEqual((await readPortfolio(db,owner.id)).events,before.events);
  const {id:permissionId,...sourcePermission}=permission;assert.ok(permissionId);await persistSource(db,{...sourcePermission,knownAt:new Date().toISOString(),uses:{...permission.uses,DISPLAY:false}});
  await assert.rejects(readInspector(db,owner.id,execution.id),/SOURCE_PERMISSION_REQUIRED/);
 }finally{await db.$disconnect()}
});
