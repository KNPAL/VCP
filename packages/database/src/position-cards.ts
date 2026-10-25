import type {PrismaClient} from '@prisma/client';
import {parseFixed,formatFixed} from '@vcp/domain';
import {ema21} from '@vcp/indicators';
import {openEpisode} from '@vcp/portfolio';
import {readPortfolioRisk} from './portfolio-risk.js';
import {readPositionStops} from './protective-stops.js';
import {readPositionStatus} from './position-status.js';
import type {DailyStructureResult} from './daily-structure.js';

/** Exact presentation arithmetic. Mark-dependent values must remain unknown without a verified mark. */
export function positionCardValues(input:{quantity:number;remainingCost:string;entry:string;initialStop:string|null;mark:string|null}){
 const initialRisk=input.initialStop===null?null:parseFixed(input.entry)-parseFixed(input.initialStop);
 return {unrealizedPnl:input.mark===null?null:formatFixed(parseFixed(input.mark)*BigInt(input.quantity)-parseFixed(input.remainingCost)),
  r0:initialRisk!==null&&initialRisk>0n?formatFixed(initialRisk):null,
  rMultiple:input.mark!==null&&initialRisk!==null&&initialRisk>0n?formatFixed((parseFixed(input.mark)-parseFixed(input.entry))*100000000n/initialRisk,8):null};
}
export async function readPositionCards(db:PrismaClient,ownerId:string){
 const [risk,stops,statuses]=await Promise.all([readPortfolioRisk(db,ownerId),readPositionStops(db,ownerId),readPositionStatus(db,ownerId)]);
 const items=await Promise.all(risk.journal.positions.map(async position=>{
  const valuation=risk.valuation.positions.find(p=>p.isin===position.isin),stop=stops.items.find(s=>s.isin===position.isin),episode=openEpisode(risk.journal.events,position.isin,risk.asOf)!;
  const consistent=stop?.quantity===position.quantity&&stop.record?.fillId===episode.first.id;
  const verifiedStop=consistent&&stop.state==='KNOWN'?stop.record:null;
  const mark=valuation?.verified&&valuation.value!==null&&valuation.quantity===position.quantity?valuation.price:null;
  const status=statuses.items.find(s=>s.evidence.isin===position.isin&&s.evidence.stopId===verifiedStop?.id);
  const currentStatus=!!status?.current&&Date.parse(status.evidence.validUntil)>Date.now();
  const listingId=verifiedStop?.stop?.listingId;
  const daily=listingId?await db.$queryRaw<{evidence:DailyStructureResult}[]>`SELECT "evidence" FROM "DailyStructureExecution" WHERE "listingId"=${listingId}::uuid AND ("evidence"->'input'->>'decidedAt')::timestamptz<=clock_timestamp() ORDER BY "session" DESC LIMIT 1`:[];
  const adjustment=listingId?await db.$queryRaw<{id:string}[]>`SELECT "id" FROM "AdjustmentSnapshot" WHERE "listingId"=${listingId}::uuid AND "asOf"<=clock_timestamp() AND "createdAt"<=clock_timestamp() ORDER BY "asOf" DESC,"createdAt" DESC,"id" LIMIT 1`:[];
  const source=daily[0]?.evidence,regime=risk.actualRisk.regimeEvidence;
  const usableEma=source&&regime.regime!=='UNKNOWN'&&source.detector.frozen.session===regime.evidence?.session&&source.input.adjustmentRevision===adjustment[0]?.id&&source.input.scaleRevision===verifiedStop?.stop?.scaleRevision;
  const metrics=positionCardValues({quantity:position.quantity,remainingCost:position.costBasis,entry:episode.first.price,initialStop:verifiedStop?.initialStop?.activeStop??null,mark});
  return {isin:position.isin,quantity:position.quantity,remainingEntry:position.weightedEntry.weightedEntry,costBasis:position.costBasis,realizedPnl:position.realizedPnl,...metrics,
   initialEntry:episode.first.price,initialStop:verifiedStop?.initialStop?.activeStop??null,activeStop:verifiedStop?.stop?.activeStop??null,stopId:verifiedStop?.id??null,
   mark,markAt:valuation?.quoteAt??null,companyExposure:valuation?.value??null,sector:valuation?.sector??null,sectorExposure:valuation?.sector?risk.valuation.sectorExposure[valuation.sector]??null:null,
   ema21:usableEma?ema21(source.input.series).value:null,emaSourceAt:usableEma?source.input.series.asOf:null,executionId:source?.id??null,
   status:currentStatus?status!.result.action:'UNABLE_TO_EVALUATE',monitoring:currentStatus?status!.result.health:'MONITOR_DEGRADED',statusAt:status?.evidence.asOf??null,statusValidUntil:currentStatus?status!.evidence.validUntil:null,
   riskStatus:risk.actualRisk.state,reasons:[...risk.actualRisk.breaches,...risk.actualRisk.unknown,...(!consistent?['JOURNAL_CHANGED_OR_STOP_MISSING']:[]),...(!usableEma?['EMA_SOURCE_UNVERIFIED']:[]),...(status?.result.reasons??[])]};
 }));
 return {asOf:risk.asOf,validUntil:risk.validUntil,journalHash:risk.journalHash,state:risk.journal.state,items,executable:false};
}
