import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt,createHash} from 'node:crypto';
import {parseFixed,formatFixed} from '../packages/domain/dist/index.js';
import {PrismaClient,appendPortfolio,readPortfolio,recordPortfolioRisk,readPortfolioRisk,persistInstrumentSnapshot,persistSectors} from '../packages/database/dist/index.js';
const db=new PrismaClient(),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
test('risk evidence preserves actual fills, expires marks and serializes with journal changes',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow(),isin='INE'+String(randomInt(1000000000)).padStart(9,'0'),listingId=randomUUID(),date=new Date(Date.now()+19800000).toISOString().slice(0,10),before=new Date(Date.now()-10000).toISOString();
  const mapping=await persistInstrumentSnapshot(db,{knownAt:new Date().toISOString(),sourceReference:'synthetic-risk-only',rows:[{companyId:randomUUID(),isin,listingId,exchange:'NSE',series:'EQ',symbol:'RISK',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]});
  const calendar=[{date,kind:'SPECIAL',opensAt:new Date(date+'T00:00:00+05:30').toISOString(),closesAt:new Date(date+'T23:59:59+05:30').toISOString(),finalizedAt:null,knownAt:before,source:'synthetic-risk-test',verified:true}],calendarId=hash(randomUUID());
  await db.$executeRaw`INSERT INTO "CalendarSnapshot" ("id","evidence") VALUES (${calendarId},${JSON.stringify(calendar)}::jsonb)`;
  await persistSectors(db,[{isin,sector:'RISK_TEST',validFrom:'2020-01-01',validTo:null,knownAt:before,sourceReference:'synthetic-sector'}],new Date().toISOString());
  const adjustmentId=hash(randomUUID()),actionSource={id:adjustmentId,listingId,knownAt:before,verified:true,sourceReference:'synthetic-risk-actions',coverageFrom:'2020-01-01',coverageThrough:date,actions:[]};
  await db.$executeRaw`INSERT INTO "AdjustmentSnapshot" ("id","listingId","scaleSession","asOf","state","evidence") VALUES (${adjustmentId},${listingId}::uuid,${new Date(date)},${new Date(before)},'KNOWN',${JSON.stringify({source:actionSource})}::jsonb)`;
  const buy={kind:'FILL',isin,side:'BUY',quantity:10,price:'100',fees:'0.01',brokerReference:randomUUID(),occurredAt:new Date().toISOString(),sourceId:'synthetic-risk'};
  await appendPortfolio(db,owner.id,randomUUID(),buy);
  const quote=()=>({listingId,provider:'fixture',token:'123',mappingRevision:mapping.id,rawLtp:'11000',priceDecimals:2,ltp:'110.000000',sourceAt:new Date().toISOString(),receivedAt:new Date().toISOString(),decidedAt:new Date().toISOString(),session:date,sequence:'1',quality:'FRESH',connection:'CONNECTED',executable:false,validUntil:new Date(Date.now()+20000).toISOString()});
  const first=await recordPortfolioRisk(db,owner.id,{[isin]:quote()});
  assert.equal(first.valuation.companyExposure[isin],'1100.000000',JSON.stringify({sources:first.sources,position:first.valuation.positions.find(p=>p.isin===isin)}));assert.equal(first.valuation.sectorExposure.RISK_TEST,'1100.000000');
  assert.equal(first.valuation.positions.find(p=>p.isin===isin).quantity,10);assert.equal(first.plan.state,'BUY_BLOCKED');
  assert.ok(Date.parse(first.validUntil)-Date.parse(first.asOf)<=30000);
  let view=await readPortfolioRisk(db,owner.id);assert.equal(view.snapshotId,first.id);assert.equal(view.valuation.companyExposure[isin],'1100.000000');
  const sell={...buy,side:'SELL',quantity:4,fees:'0.02',price:'111',brokerReference:randomUUID(),occurredAt:new Date().toISOString()};
  const [fill]=await Promise.all([appendPortfolio(db,owner.id,randomUUID(),sell),recordPortfolioRisk(db,owner.id,{[isin]:quote()})]);
  view=await readPortfolioRisk(db,owner.id);assert.equal(view.journal.cash,fill.portfolio.cash);assert.equal(view.valuation.positions.find(p=>p.isin===isin).quantity,6);
  if(view.reasons.includes('JOURNAL_CHANGED_SINCE_RISK_SNAPSHOT'))assert.equal(view.valuation.companyExposure[isin],null);
  const partial=await recordPortfolioRisk(db,owner.id,{[isin]:quote()});assert.equal(partial.valuation.companyExposure[isin],'660.000000');
  const correction=await appendPortfolio(db,owner.id,randomUUID(),{kind:'CORRECTION',targetId:fill.eventIds[0],reason:'synthetic correction',replacement:{...sell,quantity:3}});
  view=await readPortfolioRisk(db,owner.id);assert.ok(view.reasons.includes('JOURNAL_CHANGED_SINCE_RISK_SNAPSHOT'));assert.equal(view.valuation.companyExposure[isin],null);assert.equal(view.journal.cash,correction.portfolio.cash);assert.equal(view.journal.holdings[isin],7);
  let waiting;
  await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${owner.id}::uuid FOR UPDATE`;
   waiting=recordPortfolioRisk(db,owner.id,{[isin]:{...quote(),validUntil:new Date(Date.now()+50).toISOString()}});
   await new Promise(resolve=>setTimeout(resolve,100));
  });
  const expired=await waiting;assert.equal(expired.valuation.companyExposure[isin],null);assert.equal(expired.journal.holdings[isin],7);
  const missing=await recordPortfolioRisk(db,owner.id,{});assert.equal(missing.valuation.companyExposure[isin],null);
  const splitId=hash(randomUUID()),split={...actionSource,id:splitId,actions:[{id:'split',listingId,kind:'SPLIT',effectiveAt:before,knownAt:before,sharesAfter:'2',sharesBefore:'1',verified:true,sourceReference:'synthetic-split'}]};
  await db.$executeRaw`INSERT INTO "AdjustmentSnapshot" ("id","listingId","scaleSession","asOf","state","evidence") VALUES (${splitId},${listingId}::uuid,${new Date(date)},${new Date()},'KNOWN',${JSON.stringify({source:split})}::jsonb)`;
  const quarantined=await recordPortfolioRisk(db,owner.id,{[isin]:quote()});assert.equal(quarantined.valuation.companyExposure[isin],null);assert.ok(quarantined.reasons.includes('POSITION_PRICE_SCALE_UNVERIFIED:'+isin));
  assert.equal((await readPortfolio(db,owner.id)).holdings[isin],7);
  await assert.rejects(db.$executeRaw`UPDATE "PortfolioRiskSnapshot" SET "journalHash"='changed' WHERE "id"=${first.id}`);
  await assert.rejects(db.$executeRaw`DELETE FROM "PortfolioRiskSnapshot" WHERE "id"=${first.id}`);
  const saved=await db.$queryRaw`SELECT "evidence" FROM "PortfolioRiskSnapshot" WHERE "id"=${first.id}`;assert.deepEqual(saved[0].evidence,first);
  assert.equal((await readPortfolioRisk(db,randomUUID())).snapshotId,null);
  const outsideOwner=owner,outsideIsin='INE'+String(randomInt(1000000000)).padStart(9,'0');
  const cashBefore=parseFixed((await readPortfolio(db,owner.id)).cash),withdrawal=(cashBefore>0n?cashBefore:0n)+parseFixed('100');
  const fundingAt=new Date().toISOString();await appendPortfolio(db,outsideOwner.id,randomUUID(),{kind:'WITHDRAWAL',amount:formatFixed(withdrawal),verified:true,occurredAt:fundingAt,sourceId:'synthetic-topup'});
  const outsideFill={...buy,isin:outsideIsin,fees:'0',brokerReference:randomUUID(),occurredAt:new Date().toISOString()};
  await appendPortfolio(db,outsideOwner.id,randomUUID(),outsideFill);
  await appendPortfolio(db,outsideOwner.id,randomUUID(),{...outsideFill,side:'SELL',quantity:4,price:'110',brokerReference:randomUUID(),occurredAt:new Date().toISOString()});
  const topupKey=randomUUID(),topup={...outsideFill,quantity:2,price:'90',brokerReference:randomUUID(),occurredAt:new Date().toISOString()};
  const topupResult=await appendPortfolio(db,outsideOwner.id,topupKey,topup);assert.deepEqual(await appendPortfolio(db,outsideOwner.id,topupKey,topup),topupResult);
  assert.equal(topupResult.portfolio.holdings[outsideIsin],8);assert.equal(topupResult.portfolio.positions.find(p=>p.isin===outsideIsin).weightedEntry.weightedEntry,'97.500000');
  const actual=await recordPortfolioRisk(db,outsideOwner.id,{});assert.equal(actual.actualRisk.state,'BREACH_ACTUAL');assert.ok(actual.actualRisk.breaches.includes('CASH'));assert.equal(actual.plan.state,'BUY_BLOCKED');
  const audit=await db.$queryRaw`SELECT "evidence" FROM "PortfolioRiskSnapshot" WHERE "id"=${actual.id}`;assert.equal(audit[0].evidence.actualRisk.state,'BREACH_ACTUAL');assert.equal((await readPortfolio(db,outsideOwner.id)).holdings[outsideIsin],8);
  await appendPortfolio(db,owner.id,randomUUID(),{...outsideFill,side:'SELL',quantity:8,price:'97.5',brokerReference:randomUUID(),occurredAt:new Date().toISOString()});
  await appendPortfolio(db,owner.id,randomUUID(),{kind:'DEPOSIT',amount:formatFixed(withdrawal-parseFixed('40')),verified:true,occurredAt:new Date().toISOString(),sourceId:'synthetic-topup-restore'});
  assert.equal(parseFixed((await readPortfolio(db,owner.id)).cash),cashBefore);
 }finally{await db.$disconnect()}
});



