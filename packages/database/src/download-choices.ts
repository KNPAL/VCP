import {authorizeCalendarRows} from './calendar-permissions.js';
import {authorizeInstrumentRows} from './instruments.js';
import {authorizedUniverseAt} from './instruments.js';
import type {PrismaClient} from '@prisma/client';
import {canonicalListings,verifiedCalendar,type InstrumentSnapshot,type UniverseSnapshot,type CalendarDay} from '@vcp/market-data';
import {ownerBrokerBinding} from './broker-configuration.js';
/** Local selection metadata only. Never fetches provider data or queues work. */
export async function readDownloadChoices(db:PrismaClient,ownerId:string,accountKey?:string){
 const asOf=new Date().toISOString(),at=new Date(asOf),binding=await ownerBrokerBinding(db,ownerId,accountKey);
 const [universes,instruments]=await Promise.all([
  db.$queryRaw<{evidence:UniverseSnapshot}[]>`SELECT "evidence" FROM "UniverseSnapshot" WHERE "knownAt"<=${at}`,
  db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${at} ORDER BY "knownAt" DESC,"id" LIMIT 1`.then(rows=>authorizeInstrumentRows(db,rows))
 ]);
 const universe=await authorizedUniverseAt(db,universes.map(r=>r.evidence),asOf),mapping=instruments[0]?.evidence;
 const members=canonicalListings(mapping?[mapping]:[],universe.members,asOf),ids=members.flatMap(m=>m.primary?[m.primary.listingId]:[]);
 const [coverage,allBars,allProbes]=await Promise.all([
  db.$queryRaw<{listingId:string;calendarId:string}[]>`SELECT "listingId",evidence->>'calendarHash' AS "calendarId" FROM "CandleCoverage" WHERE "listingId"=ANY(${ids}::uuid[]) AND provider='ANGEL_ONE' AND "checkedAt"<=${at}`,
  db.$queryRaw<{listingId:string;session:Date}[]>`SELECT DISTINCT ON ("listingId") "listingId",session FROM "RawDailyCandle" WHERE "listingId"=ANY(${ids}::uuid[]) AND provider='ANGEL_ONE' AND "receivedAt"<=${at} AND "finalizedAt"<=${at} ORDER BY "listingId",session DESC`,
  binding.accountKey?db.$queryRaw<{listingId:string;session:string}[]>`SELECT DISTINCT ON (evidence->'wide'->>'listingId') evidence->'wide'->>'listingId' AS "listingId",evidence->'wide'->>'actualTo' AS session FROM "HistoricalProbe" WHERE "accountKey"=${binding.accountKey} AND "asOf"<=${at} AND "createdAt"<=${at} AND evidence->>'status'='PASSED' AND evidence->'wide'->>'status'='COMPLETE' AND evidence->'wide'->>'provider'='ANGEL_ONE' AND evidence->'wide'->>'listingId'=ANY(${ids}::text[]) AND evidence->'wide'->>'mappingSnapshotId'=${mapping?.id??''} ORDER BY evidence->'wide'->>'listingId',evidence->'wide'->>'actualTo' DESC`:Promise.resolve([])
 ]);
 const calendarIds=[...new Set(coverage.map(c=>c.calendarId).filter(Boolean))];
 const allCalendars=await db.$queryRaw<{id:string;evidence:CalendarDay[]}[]>`SELECT id,evidence FROM "CalendarSnapshot" WHERE id=ANY(${calendarIds}::text[]) AND "createdAt"<=${at}`.then(rows=>authorizeCalendarRows(db,rows));
 for(const calendar of allCalendars){calendar.evidence.forEach(day=>Object.freeze(day));Object.freeze(calendar.evidence)}
 const calendarById=new Map(allCalendars.map(c=>[c.id,c])),coverageById=new Map(coverage.map(c=>[c.listingId,c.calendarId])),barsById=new Map(allBars.map(b=>[b.listingId,b])),probesById=new Map(allProbes.map(b=>[b.listingId,b]));
 const items=[];
 for(const member of members){
  const row=member.primary;
  if(!row||row.provider!=='ANGEL_ONE'){items.push({isin:member.isin,listingId:row?.listingId??null,symbol:row?.symbol??member.isin,exchange:row?.exchange??null,enabled:false,reason:member.reason??'PROVIDER_UNSUPPORTED',finalizedThrough:null});continue}
  const savedCalendar=calendarById.get(coverageById.get(row.listingId)??''),calendars=savedCalendar?[savedCalendar]:[];
  const savedBar=barsById.get(row.listingId),bars=savedBar?[savedBar]:[];
  const savedProbe=probesById.get(row.listingId),probes=savedProbe?[savedProbe]:[];
  const candidate=[bars[0]?.session.toISOString().slice(0,10),probes[0]?.session].filter((d):d is string=>!!d).sort().at(-1);
  let finalizedThrough:string|null=null;
  if(candidate){try{const checked=verifiedCalendar(calendars[0]?.evidence??null,candidate,candidate,asOf);if(checked.state==='KNOWN'&&checked.sessions.length===1)finalizedThrough=candidate}catch{/* Unverified evidence remains unavailable. */}}
  const calendar=calendars[0]?.evidence??[];
  for(const day of [...calendar].sort((a,b)=>b.date.localeCompare(a.date))){if(day.kind==='HOLIDAY')continue;try{if(verifiedCalendar(calendar,day.date,day.date,asOf).sessions.length){if(!finalizedThrough||day.date>finalizedThrough)finalizedThrough=day.date;break}}catch{/* Invalid days cannot establish a download boundary. */}}
  items.push({isin:member.isin,listingId:row.listingId,symbol:row.symbol,exchange:row.exchange,enabled:universe.state==='KNOWN',reason:universe.state!=='KNOWN'?'UNIVERSE_UNKNOWN':finalizedThrough?null:'FINAL_SESSION_UNKNOWN',finalizedThrough,calendarFrom:calendar.map(d=>d.date).sort()[0]??null,coverageBasis:candidate?'OBSERVED_PROVIDER':'CALENDAR_EXPECTATION'});
 }
 return {asOf,universeId:'NIFTY_500',state:universe.state,reason:universe.reason,memberCount:universe.members.length,items,executable:false};
}
