import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt,createHash} from 'node:crypto';
import {PrismaClient,installBrokerSession,persistInstrumentSnapshot,appendPortfolio,brokerCircuitStore} from '../packages/database/dist/index.js';
import {brokerAccountKey} from '../packages/market-data/dist/index.js';
import {streamDependencies} from '../apps/worker/dist/stream-context.js';
const db=new PrismaClient();
test('stream context uses actual holdings, verified calendar and current encrypted credential revision',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 let owner,fill;
 try{
  owner=await db.owner.findFirstOrThrow();const clientCode='T'+randomUUID().replaceAll('-','').slice(0,12),accountKey=brokerAccountKey(clientCode),loadKey=async()=>Buffer.alloc(32,19);
  const before=new Date(Date.now()-10000).toISOString(),date=new Date(Date.now()+19800000).toISOString().slice(0,10),expiresAt=new Date(date+'T23:59:59+05:30').toISOString();
  const binding={reference:randomUUID(),accountKey,sessionRevision:randomUUID(),keyId:'fixture',expiresAt},proof={authenticated:true,staticIpVerified:true,verifiedAt:before},secrets={accessToken:'synthetic-access',apiKey:'synthetic-api',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00',clientCode,feedToken:'synthetic-feed'};
  await installBrokerSession(db,binding,secrets,proof,loadKey);
  const isin='INE'+String(randomInt(1000000000)).padStart(9,'0'),listingId=randomUUID();
  const mapping=await persistInstrumentSnapshot(db,{knownAt:new Date().toISOString(),sourceReference:'synthetic-stream',rows:[{companyId:randomUUID(),listingId,isin,exchange:'NSE',series:'EQ',symbol:'TEST',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'ANGEL_ONE',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]});
  const calendar=[{date,kind:'SPECIAL',opensAt:new Date(date+'T00:00:00+05:30').toISOString(),closesAt:expiresAt,finalizedAt:null,knownAt:before,source:'synthetic-stream',verified:true}],calendarId=createHash('sha256').update(randomUUID()).digest('hex');
  await db.$executeRaw`INSERT INTO "CalendarSnapshot" ("id","evidence") VALUES (${calendarId},${JSON.stringify(calendar)}::jsonb)`;
  fill={kind:'FILL',isin,side:'BUY',quantity:1,price:'100',fees:'0',brokerReference:randomUUID(),occurredAt:new Date().toISOString(),sourceId:'synthetic-stream'};
  await appendPortfolio(db,owner.id,randomUUID(),fill);
  const deps=streamDependencies(db,accountKey,loadKey),first=await deps.context();
  assert.ok(first.holdings.includes(isin));assert.equal(first.mapping.id,mapping.id);assert.equal(first.session.date,date);assert.equal(first.credentialRevision,binding.sessionRevision);assert.ok(!JSON.stringify(first).includes(secrets.feedToken));
  await brokerCircuitStore(db,accountKey).openCircuit(binding.sessionRevision,'AUTH_REJECTED');await assert.rejects(deps.context(),/STREAM_UNAVAILABLE/);
  const next={...binding,reference:randomUUID(),sessionRevision:randomUUID()};await installBrokerSession(db,next,secrets,{...proof,verifiedAt:new Date().toISOString()},loadKey);
  assert.equal((await deps.context()).credentialRevision,next.sessionRevision);
  const controller=new AbortController();controller.abort();await assert.rejects(deps.connect(first,{frame:()=>{},pong:()=>{},lost:()=>{}},controller.signal),/STREAM_UNAVAILABLE/);
 }finally{
  if(owner&&fill)await appendPortfolio(db,owner.id,randomUUID(),{...fill,side:'SELL',brokerReference:randomUUID(),occurredAt:new Date().toISOString()});
  await db.$disconnect();
 }
});
