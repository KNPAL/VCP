import {utcInstant,exchangeDate} from '@vcp/domain';
import {canonicalListings} from '@vcp/market-data';
import {configurationHash,ST_VCP_4_0,dailyBreakout,detectDailyStructure,type FrozenDailyStructure,type DailyStructureInput} from '@vcp/strategy';
import {historicalSlice,type HistoricalSnapshot} from './index.js';

export interface ReplayAssumption {
 session:string;knownAt:string;sourceReference:string;decidedAt?:string;
 /** Explicit historical state, not a current live account or quote. */
 portfolio:Record<string,unknown>;market:Record<string,unknown>;quote:Record<string,unknown>;
 strength:Record<string,{value:string;revision:string;knownAt:string}>;
}
const time=(value:string)=>utcInstant(value).valueOf();
const digest=configurationHash;
/** Pure daily orchestration. Fill prices and portfolio mutation belong to the fill simulator. */
export function replayDailyChronology(snapshot:HistoricalSnapshot,assumptions:readonly ReplayAssumption[]=[]){
 if(snapshot.strategyHash!==configurationHash(ST_VCP_4_0))throw new Error('UNSUPPORTED_REPLAY_STRATEGY');
 const seen=new Set<string>();
 for(const assumption of assumptions){time(assumption.knownAt);if(!assumption.sourceReference||seen.has(assumption.session))throw new Error('INVALID_REPLAY_ASSUMPTION');seen.add(assumption.session)}
 const previous=new Map<string,FrozenDailyStructure>();
 const days=snapshot.inputs.calendar.filter(day=>day.kind!=='HOLIDAY'&&day.date>=snapshot.inputs.from&&day.date<=snapshot.inputs.through&&day.finalizedAt&&time(day.finalizedAt)<=time(snapshot.inputs.knownAt)).sort((a,b)=>a.date.localeCompare(b.date));
 if(new Set(days.map(day=>day.date)).size!==days.length)throw new Error('DUPLICATE_REPLAY_SESSION');
 return days.map(day=>{
  const supplied=assumptions.find(row=>row.session===day.date),asOf=supplied?.decidedAt??day.finalizedAt!;
  if(time(asOf)<time(day.finalizedAt!)||exchangeDate(asOf)!==day.date)throw new Error('INVALID_REPLAY_DECISION_TIME');
  const slice=historicalSlice(snapshot,asOf),assumption=supplied&&time(supplied.knownAt)<=time(asOf)?supplied:null;
  const mappings=canonicalListings(snapshot.inputs.instruments,slice.universe.members,asOf);
  const next=snapshot.inputs.calendar.filter(row=>row.kind!=='HOLIDAY'&&row.date>day.date&&row.verified&&row.source&&time(row.knownAt)<=time(asOf)&&row.opensAt).sort((a,b)=>a.date.localeCompare(b.date))[0];
  // Require complete calendar coverage through the next opening; a missing day cannot be skipped.
  let earliestFillAt:string|null=next?.opensAt??null;
  if(next){for(let date=new Date(time(day.date+'T00:00:00Z')+86400000).toISOString().slice(0,10);date<next.date;date=new Date(time(date+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
   const between=snapshot.inputs.calendar.find(row=>row.date===date);
   if(!between||between.kind!=='HOLIDAY'||!between.verified||!between.source||time(between.knownAt)>time(asOf))earliestFillAt=null;
  }}
  if(earliestFillAt&&(time(earliestFillAt)<=time(asOf)||exchangeDate(earliestFillAt)!==next!.date))earliestFillAt=null;
  const results=slice.selected.map(selected=>{
   const listingId=selected.listingId,mapping=mappings.find(row=>row.isin===selected.isin)?.primary,adjustment=selected.adjustment;
   const reasons=slice.reasons.filter(reason=>reason.startsWith('CALENDAR_')||reason.endsWith(':'+listingId)||reason.startsWith('DATA_GAP:'+listingId+':'));
   if(!listingId||!mapping||!adjustment||adjustment.state!=='KNOWN'||reasons.length||adjustment.bars.at(-1)?.session!==day.date){if(listingId)previous.delete(listingId);return {isin:selected.isin,listingId,state:'UNKNOWN' as const,reasons:[...reasons,'FINALIZED_HISTORY_UNAVAILABLE'],structure:null,breakout:null,earliestFillAt:null}}
   const actionSource=snapshot.inputs.actions.filter(row=>row.listingId===listingId&&time(row.knownAt)<=time(asOf)).sort((a,b)=>time(b.knownAt)-time(a.knownAt)||a.id.localeCompare(b.id))[0]!;
   const scaleRevision=configurationHash(actionSource.actions.filter(action=>exchangeDate(action.effectiveAt)<=day.date).sort((a,b)=>a.id.localeCompare(b.id)));
   const input:DailyStructureInput={listingId,tick:mapping.tick,adjustmentRevision:adjustment.revision,scaleRevision,configHash:snapshot.strategyHash,decidedAt:asOf,strength:assumption?.strength[listingId]??null,series:{priceScale:'ADJUSTED',asOf,dataRevision:adjustment.revision,sessions:adjustment.bars.map(bar=>bar.session),bars:adjustment.bars.map(bar=>({...bar,revision:bar.rawRevisionId,endedAt:slice.calendar.sessions.find(row=>row.date===bar.session)!.closesAt!}))}};
   const breakout=dailyBreakout(input,previous.get(listingId)??null),structure=detectDailyStructure(input);
   previous.set(listingId,structure.frozen);
   return {isin:selected.isin,listingId,state:'REPLAYED' as const,reasons:[],structure,breakout,earliestFillAt:breakout.event?earliestFillAt:null};
  });
  const body={snapshotId:snapshot.id,session:day.date,sourceAt:asOf,occurredAt:asOf,decidedAt:asOf,effectiveAt:asOf,strategyRevision:snapshot.strategyHash,dataRevision:snapshot.dataRevision,bias:slice.bias,reasons:slice.reasons,assumptions:assumption??{state:'UNKNOWN',reason:'HISTORICAL_PORTFOLIO_MARKET_QUOTE_ASSUMPTIONS_MISSING'},fees:snapshot.inputs.fees,results,executable:false as const,performanceVerified:false as const};
  return {id:digest(body),...body};
 });
}
