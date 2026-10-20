import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {utcInstant} from '@vcp/domain';
import {projectPortfolio,type PortfolioEvent} from '@vcp/portfolio';
import {ST_VCP_4_0,PROFILE_VERSION,configurationHash} from '@vcp/strategy';
import type {MonitorAssessment} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {appendAlert} from './alerts.js';
type Status=Omit<MonitorAssessment,'state'>&{isin:string;quantity:number;asOf:string;gapStartedAt:string|null;state:MonitorAssessment['state']|'CLOSED'};
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export async function recordPositionMonitor(db:PrismaClient,ownerId:string,assessments:Record<string,MonitorAssessment>,asOf=new Date().toISOString()){
 const at=utcInstant(asOf);if(at>new Date())throw new Error('FUTURE_MONITOR');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const journal=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
  const portfolio=projectPortfolio(journal.map(r=>r.evidence),asOf);
  const previous=await tx.$queryRaw<{isin:string;evidence:Status}[]>`SELECT "isin","evidence" FROM "PositionMonitor" WHERE "ownerId"=${ownerId}::uuid`;
  const results:Status[]=[];
  for(const isin of new Set([...Object.keys(portfolio.holdings),...previous.map(r=>r.isin)])){
   const prior=previous.find(r=>r.isin===isin)?.evidence,quantity=portfolio.holdings[isin]??0;
   if(prior&&utcInstant(prior.asOf)>=at){results.push(prior);continue}
   let assessment=assessments[isin]??{state:'MONITOR_DEGRADED' as const,reason:'ASSESSMENT_UNAVAILABLE',sourceAt:null,listingId:null,session:asOf.slice(0,10),validUntil:null,executable:false as const};
   if(assessment.state==='FEED_FRESH'&&(!assessment.sourceAt||!assessment.validUntil||utcInstant(assessment.validUntil)<=at||at.valueOf()-utcInstant(assessment.sourceAt).valueOf()>60000||utcInstant(assessment.sourceAt)>at))assessment={...assessment,state:'MONITOR_DEGRADED',reason:'QUOTE_EXPIRED_BEFORE_RECORD'};
   const state=quantity===0?'CLOSED':assessment.state;
   const stopped=prior?.state==='FEED_FRESH'&&at.valueOf()-utcInstant(prior.asOf).valueOf()>15000&&quantity>0;
   let gapStartedAt=prior?.gapStartedAt??null;
   const event=async(kind:string,start:string|null,end:string|null,reason:string)=>{
    const id=hash([ownerId,isin,prior?.asOf??null,asOf,kind]),evidence={id,ownerId,isin,quantity,kind,eventAt:asOf,sourceAt:assessment.sourceAt,decidedAt:asOf,gapStartedAt:start,gapEndedAt:end,reason,priority:kind==='MONITOR_DEGRADED'?'URGENT':'INFO',executable:false as const};
    await tx.$executeRaw`INSERT INTO "PositionMonitorEvent" ("id","ownerId","isin","eventAt","evidence") VALUES (${id},${ownerId}::uuid,${isin},${at},${canonical(evidence)}::jsonb)`;
    if(kind==='MONITOR_DEGRADED')await appendAlert(tx,{...evidence,sourceEventId:id,sourceAt:asOf,occurredAt:asOf,effectiveAt:asOf,strategyVersion:PROFILE_VERSION,configHash:configurationHash(ST_VCP_4_0),dataRevision:hash(assessment)},[ownerId]);
   };
   if(!gapStartedAt&&(state==='MONITOR_DEGRADED'||stopped)){
    gapStartedAt=stopped?prior!.asOf:asOf;await event('MONITOR_DEGRADED',gapStartedAt,null,stopped?'MONITOR_POLL_GAP':assessment.reason);
   }
   if(gapStartedAt&&state!=='MONITOR_DEGRADED'){
    await event(state==='FEED_FRESH'?'MONITOR_RECOVERED':'MONITOR_ENDED',gapStartedAt,asOf,state==='CLOSED'?'ACTUAL_POSITION_CLOSED':assessment.reason);gapStartedAt=null;
   }
   const current:Status={...assessment,isin,quantity,state,asOf,gapStartedAt};
   await tx.$executeRaw`INSERT INTO "PositionMonitor" ("ownerId","isin","asOf","evidence") VALUES (${ownerId}::uuid,${isin},${at},${canonical(current)}::jsonb) ON CONFLICT ("ownerId","isin") DO UPDATE SET "asOf"=EXCLUDED."asOf","evidence"=EXCLUDED."evidence"`;
   results.push(current);
  }
  return results;
 });
}
export async function readPositionMonitor(db:PrismaClient,ownerId:string){
 const rows=await db.$queryRaw<{evidence:Status}[]>`SELECT "evidence" FROM "PositionMonitor" WHERE "ownerId"=${ownerId}::uuid ORDER BY "isin"`;
 const events=await db.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "PositionMonitorEvent" WHERE "ownerId"=${ownerId}::uuid ORDER BY "eventAt" DESC,"id" DESC LIMIT 100`;
 const now=Date.now();
 return {items:rows.map(r=>({...r.evidence,...(r.evidence.state!=='CLOSED'&&now-Date.parse(r.evidence.asOf)>15000?{state:'MONITOR_DEGRADED',reason:'MONITOR_WORKER_STALE'}:r.evidence.state==='FEED_FRESH'&&(!r.evidence.sourceAt||!r.evidence.validUntil||Date.parse(r.evidence.validUntil)<=now||now-Date.parse(r.evidence.sourceAt)>60000)?{state:'MONITOR_DEGRADED',reason:'QUOTE_STALE'}:{})})),events:events.map(r=>r.evidence),asOf:new Date(now).toISOString(),executable:false};
}
