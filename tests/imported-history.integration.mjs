import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {referenceSource} from '../fixtures/reference-source.mjs';
import {persistSource,importedHistoryChoices,importedHistorySeries,importedVcpResearchScan} from '../packages/database/dist/index.js';
import {historicalAverages,historySelection} from '../packages/database/dist/imported-history.js';
test('imported research is owner-scoped, series-specific, excludes flagged bars and uses preceding warmup',async()=>{
 const fixture=await isolatedDatabase('imported_history'),db=fixture.db;
 try{
  const owner=(await db.owner.findFirstOrThrow()).id,other=randomUUID(),id=createHash('sha256').update(randomUUID()).digest('hex');
  const source=await referenceSource(db,'DAILY_CANDLES'),saved=await persistSource(db,source);
  await db.$executeRaw`INSERT INTO "HistoricalDataImport" (id,"ownerId","sourceSnapshotId",status,manifest) VALUES (${id},${owner}::uuid,${saved.id},'IMPORTING','{}'::jsonb)`;
  assert.equal((await importedHistoryChoices(db,owner)).importId,null);
  const rows=Array.from({length:201},(_,i)=>({session:new Date(Date.UTC(2020,0,1)+i*86400000).toISOString().slice(0,10),close:String(i+1)}));
  for(const r of rows)await db.$executeRaw`INSERT INTO "HistoricalResearchBar" VALUES (${id},'TEST','EQ',${new Date(r.session)},${r.close}::numeric,${r.close}::numeric,${r.close}::numeric,${r.close}::numeric,100,'NSE','VALID','[]'::jsonb)`;
  await db.$executeRaw`INSERT INTO "HistoricalResearchBar" VALUES (${id},'TEST','BE','2020-01-01',99,99,99,99,100,'NSE','VALID','[]'::jsonb),(${id},'TEST','EQ','2020-12-01',0,0,0,0,0,'NSE','FLAGGED','["INVALID_OHLC"]'::jsonb)`;
  await db.$executeRaw`UPDATE "HistoricalDataImport" SET status='COMPLETED' WHERE id=${id}`;
  assert.equal((await importedHistoryChoices(db,other)).importId,null);
  await assert.rejects(importedHistorySeries(db,other,{symbol:'TEST',series:'EQ',from:'2020-01-01',to:'2020-12-01'}),/NOT_FOUND/);
  const series=await importedHistorySeries(db,owner,{symbol:'TEST',series:'EQ',from:rows[199].session,to:'2020-12-01'});
  assert.equal(series.bars.length,2);assert.equal(series.bars[0].sma200,100.5);assert.equal(series.bars[1].sma200,101.5);assert.equal(series.excluded[0].count,1);
  assert.equal((await importedHistorySeries(db,owner,{symbol:'TEST',series:'BE',from:'2020-01-01',to:'2020-12-01'})).bars[0].close,'99.000000');
  const averages=historicalAverages(rows);assert.equal(averages[198].sma200,null);assert.equal(averages[49].sma50,25.5);
  assert.throws(()=>historySelection({symbol:'TEST',series:'EQ',from:'2020-02-30',to:'2020-12-01'}),/INVALID/);
  const action=await persistSource(db,await referenceSource(db,'CORPORATE_ACTIONS')),benchmark=await persistSource(db,await referenceSource(db,'BENCHMARK'));
  const evidence={sourceSnapshotIds:[saved.id,action.id,benchmark.id],scope:'IMPORTED_EQ_RESEARCH',executable:false};
  await db.$executeRaw`INSERT INTO "ImportedVcpResearchScan" (id,"ownerId","importId",session,evidence) VALUES (${id},${owner}::uuid,${id},'2020-12-01',${JSON.stringify(evidence)}::jsonb)`;
  assert.equal(await importedVcpResearchScan(db,other),null);
  assert.equal((await importedVcpResearchScan(db,owner)).executable,false);
  await new Promise(r=>setTimeout(r,5));await persistSource(db,{...source,knownAt:new Date().toISOString(),uses:{...source.uses,DISPLAY:false}});
  await assert.rejects(importedHistoryChoices(db,owner),/SOURCE_PERMISSION_REQUIRED/);
  await assert.rejects(importedVcpResearchScan(db,owner),/SOURCE_PERMISSION_REQUIRED/);
 }finally{await fixture.close()}
});
