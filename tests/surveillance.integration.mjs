import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {PrismaClient,persistInstrumentSnapshot,persistSurveillance,readSurveillance,registerProfile,persistMarketEvent,recordPortfolioRisk,recordEntryRisk,readEntryRisk} from '../packages/database/dist/index.js';
import {ST_VCP_4_0,PROFILE_VERSION,evaluateBreakout} from '../packages/strategy/dist/index.js';
import {breakoutInput} from '../fixtures/signal-golden.mjs';
const db=new PrismaClient();
test('surveillance requires current per-listing evidence, rights, chronology and canonical identity',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const knownAt=new Date(Date.now()-1000).toISOString(),validUntil=new Date(Date.now()+60000).toISOString(),listingId=randomUUID(),isin='INE'+String(randomInt(1000000000)).padStart(9,'0');
  const mapping=await persistInstrumentSnapshot(db,{knownAt,sourceReference:'synthetic-surveillance',rows:[{companyId:randomUUID(),listingId,isin,exchange:'NSE',series:'EQ',symbol:'SURV',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture',token:'124',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]});
  const source={dataset:'surveillance',provider:'synthetic',endpointOrFile:'fixture.json',licenseRef:'synthetic-test-only',uses:{STORE:true,DERIVE:true,DISPLAY:true,DOWNLOAD:true,REDISTRIBUTE:false},updateFrequency:'daily',asOf:knownAt,knownAt,effectiveAt:knownAt,validUntil,lastVerified:knownAt,maximumAgeMs:60000,adjustmentPolicy:'current exchange bands',coverage:{intended:1,available:1},error:null};
  const evidence={listingId,mappingRevision:mapping.id,source,restrictions:{verified:true,knownAt,sourceAt:knownAt,validUntil,asm:false,gsm:false,esm:false,cashTradable:true,lowerBand:'90.00',upperBand:'110.00'}};
  assert.equal((await readSurveillance(db,listingId)).status,'UNKNOWN');
  const saved=await persistSurveillance(db,evidence);assert.deepEqual(await persistSurveillance(db,evidence),saved);
  const current=await readSurveillance(db,listingId);assert.equal(current.status,'PASS');assert.equal(current.lowerBand,'90.00');assert.equal(current.revision,saved.id);
  const owner=await db.owner.findFirstOrThrow(),profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0),input=breakoutInput();input.previous.listingId=listingId;input.previous.configHash=profile.id;input.evidence.configHash=profile.id;input.evidence.dataRevision=randomUUID();
  const event=evaluateBreakout(input).event;await persistMarketEvent(db,event);
  const risk=await recordPortfolioRisk(db,owner.id,{}),request={marketEventId:event.id,snapshotId:risk.id,estimatedFees:'0'},plan=await recordEntryRisk(db,owner.id,randomUUID(),request);
  assert.equal(plan.entryEvidence.evidence.gates.G06,'PASS');assert.equal(plan.readinessEvidence.surveillance.revision,saved.id);assert.equal(plan.state,'BUY_BLOCKED');
  assert.equal((await readSurveillance(db,listingId,validUntil)).status,'UNKNOWN');
  await assert.rejects(persistSurveillance(db,{...evidence,source:{...source,uses:{...source.uses,STORE:false}}}),/STORAGE_DENIED/);
  await assert.rejects(persistSurveillance(db,{...evidence,restrictions:{...evidence.restrictions,asm:undefined}}),/INVALID_SURVEILLANCE/);
  await assert.rejects(persistSurveillance(db,{...evidence,restrictions:{...evidence.restrictions,sourceAt:validUntil}}),/CHRONOLOGY/);
  await assert.rejects(persistSurveillance(db,{...evidence,listingId:randomUUID()}),/MAPPING_MISMATCH/);
  const save=async patch=>{await persistSurveillance(db,{...evidence,...patch,restrictions:{...evidence.restrictions,...patch.restrictions,knownAt:new Date().toISOString()}});return readSurveillance(db,listingId)};
  assert.equal((await save({restrictions:{asm:true}})).status,'FAIL');
  const blocked=await recordEntryRisk(db,owner.id,randomUUID(),request);assert.equal(blocked.entryEvidence.evidence.gates.G06,'FAIL');assert.ok(blocked.reasons.includes('TRADING_RESTRICTED'));
  assert.ok((await readEntryRisk(db,owner.id)).items.find(item=>item.evidence.id===plan.id).validityReasons.includes('ENTRY_SOURCE_CHANGED_OR_UNVERIFIED'));
  assert.equal((await save({restrictions:{gsm:null}})).status,'UNKNOWN');
  const denied=await save({source:{...source,uses:{...source.uses,DERIVE:false}}});assert.equal(denied.status,'UNKNOWN');assert.equal(denied.lowerBand,null);assert.ok(denied.reasons.includes('LICENSE_PERMISSION_DENIED'));
  await save({});await persistInstrumentSnapshot(db,{knownAt:new Date().toISOString(),sourceReference:'synthetic-correction',rows:mapping.rows});
  assert.ok((await readSurveillance(db,listingId)).reasons.includes('SURVEILLANCE_MAPPING_CHANGED'));
  await assert.rejects(db.$executeRaw`UPDATE "SurveillanceSnapshot" SET "evidence"='{}'::jsonb WHERE "id"=${saved.id}`);
  await assert.rejects(db.$executeRaw`DELETE FROM "SurveillanceSnapshot" WHERE "id"=${saved.id}`);
 }finally{await db.$disconnect()}
});
