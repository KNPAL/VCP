import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {PrismaClient,persistInstrumentSnapshot,persistIpoListing,readIpoResearch,listIpoResearch} from '../packages/database/dist/index.js';
const db=new PrismaClient();
test('IPO metadata revisions are immutable and missing data never gains BUY permission',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const listingId=randomUUID(),metadata={listingId,isin:'INE'+String(randomInt(1000000000)).padStart(9,'0'),listingDate:'2026-10-01',issuePrice:null,listingPrice:null,knownAt:new Date(Date.now()-1000).toISOString(),sourceReference:'synthetic-reviewed-source',permissionReference:'synthetic-test-only',verified:true};
  await assert.rejects(persistIpoListing(db,metadata),/IPO_VERIFIED_LISTING_MISMATCH/);
  await persistInstrumentSnapshot(db,{knownAt:new Date(Date.parse(metadata.knownAt)-1000).toISOString(),sourceReference:'synthetic-ipo-mapping',rows:[{companyId:randomUUID(),isin:metadata.isin,listingId,exchange:'NSE',series:'EQ',symbol:'IPO',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:metadata.listingDate,provider:'fixture',token:'123',validFrom:metadata.listingDate,validTo:null,verified:true,enabled:true}]});
  await assert.rejects(persistIpoListing(db,{...metadata,listingDate:'2026-09-01'}),/IPO_VERIFIED_LISTING_MISMATCH/);
  const [a,b]=await Promise.all([persistIpoListing(db,metadata),persistIpoListing(db,metadata)]);assert.deepEqual(a,b);
  const view=await readIpoResearch(db,listingId);assert.equal(view.metadataRevision,a.id);assert.equal(view.state,'UNKNOWN');assert.equal(view.metadata.issuePrice,null);assert.equal(view.buyEligible,false);assert.equal(view.executable,false);assert.ok((await listIpoResearch(db)).items.some(i=>i.id===a.id));
  await assert.rejects(db.$executeRaw`DELETE FROM "IpoListingSnapshot" WHERE "id"=${a.id}`);
  const correction=await persistIpoListing(db,{...metadata,verified:false,knownAt:new Date(Date.parse(metadata.knownAt)+1).toISOString()});assert.notEqual(correction.id,a.id);const corrected=await readIpoResearch(db,listingId);assert.equal(corrected.metadataRevision,correction.id);assert.equal(corrected.metadata,null);assert.equal(corrected.buyState,'BUY_BLOCKED');
  await assert.rejects(persistIpoListing(db,{...metadata,knownAt:'2099-01-01T00:00:00Z'}),/IPO_FUTURE_SOURCE/);
 }finally{await db.$disconnect()}
});
