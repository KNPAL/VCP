import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {PrismaClient,importInstrumentMaster} from '../packages/database/dist/index.js';
import {masterFixture} from '../fixtures/instrument-master.mjs';
test('master imports persist immutable lineage, retry across restart and quarantine mismatches',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();
 try{
  const input=masterFixture(new Date(Date.now()-1000).toISOString());input.mappings[0].companyId=randomUUID();input.mappings[0].listingId=randomUUID();input.mappings[0].isin='INE'+String(randomInt(1000000000)).padStart(9,'0');
  const imported=await importInstrumentMaster(db,input);assert.equal(imported.status,'VALIDATED');assert.equal(imported.counts.accepted,1);
  const restart=new PrismaClient();try{assert.deepEqual(await importInstrumentMaster(restart,input),imported)}finally{await restart.$disconnect()}
  const snapshots=await db.$queryRaw`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "id"=${imported.snapshotId}`;assert.equal(snapshots[0].evidence.sourceReference,imported.id);assert.equal(snapshots[0].evidence.rows[0].tick,'0.050000');
  await assert.rejects(db.$executeRaw`UPDATE "InstrumentMasterImport" SET "evidence"='{}'::jsonb WHERE "id"=${imported.id}`);
  const denied=structuredClone(input);denied.source.uses.STORE=false;await assert.rejects(importInstrumentMaster(db,denied),/NOT_PERMITTED/);
  const bad=structuredClone(input);bad.records[0].tick_size='1';bad.knownAt=new Date().toISOString();const partial=await importInstrumentMaster(db,bad);assert.equal(partial.status,'PARTIAL');assert.equal(partial.counts.accepted,0);assert.equal(partial.report[0].reason,'MASTER_TICK_OR_LOT_MISMATCH');
  const rejected=await db.$queryRaw`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "id"=${partial.snapshotId}`;assert.deepEqual(rejected[0].evidence.rows,[]);
 }finally{await db.$disconnect()}
});
