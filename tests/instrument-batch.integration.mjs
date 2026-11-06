import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {persistInstrumentSnapshot,assertEodScanDisplay,persistSource} from '../packages/database/dist/index.js';
import {actionPermission,candlePermission} from '../fixtures/candle-permission.mjs';

test('full-universe instrument batch retries atomically and rejects identity conflicts',async()=>{
 const fixture=await isolatedDatabase('instrument_batch'),db=fixture.db;
 try{
  const rows=Array.from({length:500},(_,n)=>({listingId:randomUUID(),companyId:randomUUID(),isin:'INE'+String(n+1).padStart(9,'0'),exchange:'NSE',series:'EQ',symbol:'SYNTH'+n,instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture',token:String(n+1),validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}));
  const input={knownAt:new Date().toISOString(),sourceReference:'synthetic-batch',rows};
  const saved=await persistInstrumentSnapshot(db,input);
  assert.equal((await persistInstrumentSnapshot(db,input)).id,saved.id);
  assert.equal(await db.company.count(),500);assert.equal(await db.listing.count(),500);assert.equal(await db.listingMapping.count(),500);
  for(const changes of [{companyId:randomUUID()},{exchange:'BSE'}]){
   await assert.rejects(persistInstrumentSnapshot(db,{...input,rows:[{...rows[0],...changes}]}),/IDENTITY_CONFLICT/);
   assert.equal(await db.instrumentSnapshot.count(),1);assert.equal(await db.company.count(),500);assert.equal(await db.listingMapping.count(),500);
  }
  const empty=await persistInstrumentSnapshot(db,{...input,rows:[]});assert.equal(empty.rows.length,0);
 }finally{await fixture.close()}
});

test('server-side scan lineage rejects absent, malformed and unlicensed raw contributions',async()=>{
 const fixture=await isolatedDatabase('scan_lineage'),db=fixture.db;
 try{
  const sourceSnapshotId=await actionPermission(db),rawId=randomUUID(),provider='synthetic-lineage';
  await db.candleRevision.create({data:{id:rawId,listingId:randomUUID(),session:new Date('2026-01-01'),scale:'RAW',revision:1,open:'1',high:'1',low:'1',close:'1',volume:1n,source:provider,receivedAt:new Date(),finalizedAt:new Date()}});
  const make=async bars=>{
   const id=createHash('sha256').update(randomUUID()).digest('hex'),scanId=randomUUID();
   await db.$executeRaw`INSERT INTO "AdjustmentSnapshot" (id,"listingId","scaleSession","asOf",state,evidence) VALUES (${id},${randomUUID()}::uuid,'2026-01-01'::date,clock_timestamp(),'KNOWN',${JSON.stringify({source:{sourceSnapshotId},result:{bars}})}::jsonb)`;
   await db.$executeRaw`INSERT INTO "EodScanPlan" (id,evidence) VALUES (${scanId}::uuid,${JSON.stringify({benchmarkAdjustmentId:null,items:[{adjustmentId:id}]})}::jsonb)`;
   return scanId;
  };
  for(const bars of [null,{},[],[{}],[{rawRevisionId:'bad'}],[{rawRevisionId:randomUUID()}],[{rawRevisionId:rawId},{}]]){
   await assert.rejects(assertEodScanDisplay(db,await make(bars)),/SOURCE_LINEAGE_MISSING/);
  }
  const valid=await make([{rawRevisionId:rawId}]);
  await assert.rejects(assertEodScanDisplay(db,valid),/SOURCE_PERMISSION_REQUIRED/);
  await candlePermission(db,provider);await assertEodScanDisplay(db,valid);
  const fast=randomUUID();
  await db.$executeRaw`INSERT INTO "EodScanPlan" (id,evidence) VALUES (${fast}::uuid,${JSON.stringify({benchmarkAdjustmentId:null,items:[],permissionLineage:{providers:[provider],actionSourceIds:[sourceSnapshotId]}})}::jsonb)`;
  await assertEodScanDisplay(db,fast);
  const [source]=await db.$queryRaw`SELECT evidence FROM "SourceSnapshot" WHERE id=${sourceSnapshotId}`;
  const {id,...grant}=source.evidence;assert.equal(id,sourceSnapshotId);
  await persistSource(db,{...grant,knownAt:new Date().toISOString(),uses:{...grant.uses,DISPLAY:false}});
  for(const scan of [valid,fast])await assert.rejects(assertEodScanDisplay(db,scan),/SOURCE_PERMISSION_REQUIRED/);
 }finally{await fixture.close()}
});
