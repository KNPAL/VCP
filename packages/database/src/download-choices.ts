import type {PrismaClient} from '@prisma/client';
import {canonicalListings,universeAt,verifiedCalendar,type InstrumentSnapshot,type UniverseSnapshot,type CalendarDay} from '@vcp/market-data';
import {ownerBrokerBinding} from './broker-configuration.js';
/** Local selection metadata only. Never fetches provider data or queues work. */
export async function readDownloadChoices(db:PrismaClient,ownerId:string,accountKey?:string){
 const asOf=new Date().toISOString(),at=new Date(asOf),binding=await ownerBrokerBinding(db,ownerId,accountKey);
 const [universes,instruments]=await Promise.all([
  db.$queryRaw<{evidence:UniverseSnapshot}[]>`SELECT "evidence" FROM "UniverseSnapshot" WHERE "knownAt"<=${at}`,
  db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${at} ORDER BY "knownAt" DESC,"id" LIMIT 1`
 ]);
 const universe=universeAt(universes.map(r=>r.evidence),asOf),mapping=instruments[0]?.evidence;
 const items=[];
 for(const member of canonicalListings(mapping?[mapping]:[],universe.members,asOf)){
  const row=member.primary;
  if(!row||row.provider!=='ANGEL_ONE'){items.push({isin:member.isin,listingId:row?.listingId??null,symbol:row?.symbol??member.isin,exchange:row?.exchange??null,enabled:false,reason:member.reason??'PROVIDER_UNSUPPORTED',finalizedThrough:null});continue}
  const calendars=await db.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT s."evidence" FROM "CandleCoverage" c JOIN "CalendarSnapshot" s ON s."id"=c."evidence"->>'calendarHash' WHERE c."listingId"=${row.listingId}::uuid AND c."provider"='ANGEL_ONE' AND c."checkedAt"<=${at} AND s."createdAt"<=${at}`;
  const bars=await db.$queryRaw<{session:Date}[]>`SELECT "session" FROM "RawDailyCandle" WHERE "listingId"=${row.listingId}::uuid AND "provider"='ANGEL_ONE' AND "receivedAt"<=${at} AND "finalizedAt"<=${at} ORDER BY "session" DESC LIMIT 1`;
  const probes=binding.accountKey?await db.$queryRaw<{session:string}[]>`SELECT "evidence"->'wide'->>'actualTo' AS session FROM "HistoricalProbe" WHERE "accountKey"=${binding.accountKey} AND "asOf"<=${at} AND "createdAt"<=${at} AND "evidence"->>'status'='PASSED' AND "evidence"->'wide'->>'status'='COMPLETE' AND "evidence"->'wide'->>'provider'='ANGEL_ONE' AND "evidence"->'wide'->>'listingId'=${row.listingId} AND "evidence"->'wide'->>'mappingSnapshotId'=${mapping!.id} ORDER BY "evidence"->'wide'->>'actualTo' DESC LIMIT 1`:[];
  const candidate=[bars[0]?.session.toISOString().slice(0,10),probes[0]?.session].filter((d):d is string=>!!d).sort().at(-1);
  let finalizedThrough:string|null=null;
  if(candidate){try{const checked=verifiedCalendar(calendars[0]?.evidence??null,candidate,candidate,asOf);if(checked.state==='KNOWN'&&checked.sessions.length===1)finalizedThrough=candidate}catch{/* Unverified evidence remains unavailable. */}}
  items.push({isin:member.isin,listingId:row.listingId,symbol:row.symbol,exchange:row.exchange,enabled:universe.state==='KNOWN',reason:universe.state!=='KNOWN'?'UNIVERSE_UNKNOWN':finalizedThrough?null:'FINAL_SESSION_UNKNOWN',finalizedThrough});
 }
 return {asOf,universeId:'NIFTY_500',state:universe.state,memberCount:universe.members.length,items,executable:false};
}
