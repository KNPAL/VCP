import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {PrismaClient,persistInstrumentSnapshot,persistSmeResearch,readSmeResearch,listSmeResearch} from '../packages/database/dist/index.js';
import {smeEvidence} from '../fixtures/sme-research.mjs';
const db=new PrismaClient();
test('SME reviewed sources preserve revisions, reject identity/lot mismatches and retain UNKNOWN',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const evidence={...smeEvidence(new Date(Date.now()-1000).toISOString()),listingId:randomUUID(),isin:'INE'+String(randomInt(1000000000)).padStart(9,'0')};
  await assert.rejects(persistSmeResearch(db,evidence),/SME_VERIFIED_LISTING_MISMATCH/);
  await persistInstrumentSnapshot(db,{knownAt:new Date(Date.parse(evidence.knownAt)-1000).toISOString(),sourceReference:'synthetic-sme',rows:[{companyId:randomUUID(),isin:evidence.isin,listingId:evidence.listingId,exchange:'NSE',series:'SME',symbol:'SME',instrumentType:'EQUITY',tick:'0.05',lot:100,listingDate:'2026-01-01',provider:'fixture',token:'123',validFrom:'2026-01-01',validTo:null,verified:true,enabled:true}]});
  await assert.rejects(persistSmeResearch(db,{...evidence,source:{...evidence.source,uses:{...evidence.source.uses,STORE:false}}}),/SME_STORAGE_PERMISSION_REQUIRED/);
  await assert.rejects(persistSmeResearch(db,{...evidence,lot:10}),/SME_VERIFIED_LISTING_MISMATCH/);
  const [a,b]=await Promise.all([persistSmeResearch(db,evidence),persistSmeResearch(db,evidence)]);assert.deepEqual(a,b);let view=await readSmeResearch(db,evidence.listingId);assert.equal(view.metadataRevision,a.id);assert.equal(view.lot,100);assert.equal(view.state,'UNKNOWN');assert.equal(view.buyEligible,false);assert.equal(view.guaranteedFill,false);assert.ok((await listSmeResearch(db)).items.some(i=>i.id===a.id));
  await assert.rejects(db.$executeRaw`DELETE FROM "SmeResearchSnapshot" WHERE "id"=${a.id}`);
  const replacement=await persistSmeResearch(db,{...evidence,knownAt:new Date(Date.parse(evidence.knownAt)+1).toISOString(),source:{...evidence.source,uses:{...evidence.source.uses,DISPLAY:false}}});view=await readSmeResearch(db,evidence.listingId);assert.equal(view.metadataRevision,replacement.id);assert.equal(view.lot,null);assert.equal(view.restrictions,null);assert.equal(view.buyState,'BUY_BLOCKED');
 }finally{await db.$disconnect()}
});
