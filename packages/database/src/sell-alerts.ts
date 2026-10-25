import type {PrismaClient} from '@prisma/client';
import {exitPrecedence} from '@vcp/portfolio';
import {readPositionStops} from './protective-stops.js';
import {readPositionStatus} from './position-status.js';
import {readExitCandidates} from './exit-decisions.js';
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};
const string=(v:unknown)=>typeof v==='string'?v:null;
export function sellAlertSource(source:Record<string,unknown>){
 const quote=object(source['quote']),result=object(source['result']),input=object(source['input']);
 const failureSession=Array.isArray(input['sessions'])?input['sessions'].map(object).find(s=>s['date']===result['triggerSession']):null;
 return {sourcePrice:string(source['triggeredPrice']??quote['ltp']??result['triggeredPrice']??input['close']??failureSession?.['close']),sourceAt:string(source['observedTickAt']??quote['sourceAt']??result['sourceAt']??source['occurredAt']??input['closedAt']??failureSession?.['closedAt'])};
}
export async function readSellAlerts(db:PrismaClient,ownerId:string){
 const [stops,statuses]=await Promise.all([readPositionStops(db,ownerId),readPositionStatus(db,ownerId)]),asOf=new Date().toISOString();
 const items=await Promise.all(stops.items.map(async position=>{
  const stop=position.record,status=statuses.items.find(s=>s.evidence.stopId===stop?.id),candidates=stop?await readExitCandidates(db,stop.id):[];
  let decision:ReturnType<typeof exitPrecedence>|null=null;
  try{decision=exitPrecedence(candidates,position.quantity,asOf)}catch{/* Preserve UNKNOWN when immutable source metadata is incomplete. */}
  const primary=decision?.primary;
  const evidence=primary?await db.$queryRaw<{evidence:Record<string,unknown>}[]>`SELECT "evidence" FROM "ProtectiveSignal" WHERE "ownerId"=${ownerId}::uuid AND "id"=${primary.id} UNION ALL SELECT "evidence" FROM "PositionFailure" WHERE "ownerId"=${ownerId}::uuid AND "id"=${primary.id} UNION ALL SELECT "evidence" FROM "PositionTrail" WHERE "ownerId"=${ownerId}::uuid AND "id"=${primary.id} UNION ALL SELECT "evidence" FROM "PartialProfitSignal" WHERE "ownerId"=${ownerId}::uuid AND "id"=${primary.id}`:[];
  const acknowledgement=primary?await db.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "PositionAlertAcknowledgement" WHERE "ownerId"=${ownerId}::uuid AND "signalId"=${primary.id}`:[];
  const source=evidence[0]?.evidence??{};
  const suggested=source['quantity'];
  return {isin:position.isin,positionId:stop?.episodeId??null,remainingQuantity:position.quantity,activeStop:position.state==='KNOWN'?stop?.stop?.activeStop??null:null,
   state:decision?.state??'UNKNOWN',primary:primary?{...primary,quantity:primary.kind==='PARTIAL_PROFIT'?typeof suggested==='number'&&Number.isSafeInteger(suggested)&&suggested>0?Math.min(position.quantity,suggested):null:position.quantity,
    ...sellAlertSource(source),acknowledgement:acknowledgement[0]?.evidence??null,evidence:source}:null,
   effective:decision?.effective??false,suppressedCount:decision?.secondary.length??0,monitoring:status?.current?status.result.health:'MONITOR_DEGRADED',statusCurrent:status?.current??false,statusValidUntil:status?.evidence.validUntil??null,
   evidenceState:position.state,reasons:[position.reason,...(status?.result.reasons??['POSITION_STATUS_UNAVAILABLE'])],manualExecutionPending:!!primary,executable:false};
 }));
 const priority=['SELL_PROTECTIVE','SELL_BREAKOUT_FAILURE','SELL_EMA_CLOSE','PARTIAL_PROFIT'];
 items.sort((a,b)=>(a.primary?priority.indexOf(a.primary.kind):4)-(b.primary?priority.indexOf(b.primary.kind):4)||a.isin.localeCompare(b.isin));
 return {asOf,validUntil:new Date(Date.parse(asOf)+15000).toISOString(),items,executable:false};
}
