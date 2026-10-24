import {utcInstant,exchangeDate} from '@vcp/domain';
import {ema21,atr14,type Series} from '@vcp/indicators';
import {trailingStop,breakoutFailure} from '@vcp/portfolio';
import {canonicalListings} from '@vcp/market-data';
import {configurationHash,ST_VCP_4_0} from '@vcp/strategy';
import {historicalSlice,type HistoricalSnapshot} from './index.js';
import type {SimulatedPosition} from './daily-exit.js';
export function paperEodProtection(snapshot:HistoricalSnapshot,position:SimulatedPosition&{buySession:string;pivot:string|null;trailActivated:boolean},asOf:string){
 if(snapshot.strategyHash!==configurationHash(ST_VCP_4_0))throw new Error('UNSUPPORTED_REPLAY_STRATEGY');
 const slice=historicalSlice(snapshot,asOf),date=exchangeDate(asOf),selected=slice.selected.find(row=>row.listingId===position.listingId),adjustment=selected?.adjustment;
 const mapping=selected?canonicalListings(snapshot.inputs.instruments,[selected.isin],asOf)[0]?.primary:null;
 const base={snapshotId:snapshot.id,positionId:position.id,asOf,bias:slice.bias,limitations:slice.reasons,executable:false as const,performanceVerified:false as const};
 if(!adjustment||adjustment.state!=='KNOWN'||!mapping||adjustment.bars.at(-1)?.session!==date||position.scaleSession!==date||slice.calendar.state!=='KNOWN'||slice.reasons.some(reason=>reason.startsWith('DATA_GAP:'+position.listingId+':')))return {...base,state:'UNKNOWN' as const,reasons:['EOD_POSITION_HISTORY_UNAVAILABLE'],trail:null,failure:null,scheduledSell:null};
 const calendar=snapshot.inputs.calendar,next=calendar.filter(day=>day.date>date&&day.kind!=='HOLIDAY').sort((a,b)=>a.date.localeCompare(b.date))[0];
 let nextSession=next?.verified&&next.source&&next.opensAt&&utcInstant(next.knownAt)<=utcInstant(asOf)?{date:next.date,opensAt:next.opensAt}:null;
 if(nextSession)for(let d=new Date(utcInstant(date+'T00:00:00Z').valueOf()+86400000).toISOString().slice(0,10);d<nextSession.date;d=new Date(utcInstant(d+'T00:00:00Z').valueOf()+86400000).toISOString().slice(0,10)){
  const holiday=calendar.find(day=>day.date===d);if(!holiday||holiday.kind!=='HOLIDAY'||!holiday.verified||!holiday.source||utcInstant(holiday.knownAt)>utcInstant(asOf)){nextSession=null;break}
 }
 const series:Series={priceScale:'ADJUSTED',bars:adjustment.bars.map(bar=>({...bar,revision:bar.rawRevisionId})),sessions:adjustment.bars.map(bar=>bar.session),asOf,dataRevision:adjustment.revision};
 const ema=ema21(series),atr=atr14(series),today=adjustment.bars.at(-1)!,session=slice.calendar.sessions.find(day=>day.date===date)!;
 const trail=trailingStop({entry:position.entry,initialStop:position.initialStop,activeStop:position.activeStop,tick:mapping.tick,close:today.close,ema21:ema.value,atr14:atr.value,activated:position.trailActivated,scaleVerified:true,session:date,closedAt:session.closesAt!,finalizedAt:today.finalizedAt,asOf,nextSession,sourceRevision:adjustment.revision});
 const failure=breakoutFailure({buySession:position.buySession,pivot:position.pivot,scaleVerified:true,asOf,sessions:adjustment.bars.map(bar=>({date:bar.session,close:bar.close,closedAt:slice.calendar.sessions.find(day=>day.date===bar.session)!.closesAt!,finalizedAt:bar.finalizedAt})),nextSessions:nextSession?[nextSession]:[]});
 const scheduledSell=failure.state==='SELL_BREAKOUT_FAILURE'?{kind:failure.state,effectiveAt:failure.effectiveAt}:trail.state==='SELL_EMA_CLOSE'?{kind:trail.state,effectiveAt:trail.effectiveAt}:null;
 const body={...base,state:'EVALUATED' as const,reasons:[],sourceRevision:adjustment.revision,trail,failure,scheduledSell};
 return {id:configurationHash(body),...body};
}
