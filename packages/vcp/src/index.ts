import {createHash} from 'node:crypto';
import {parseFixed,STRATEGY_VERSION,utcInstant} from '@vcp/domain';
import {Q,validateSeries,vdu,atr14,trendTemplate,type Series,type Bar} from '@vcp/indicators';
export const ALGORITHM='ST_VCP_LOCAL_EXTREMA_V1';
export interface VcpBar extends Bar {endedAt:string}
export interface VcpSeries extends Omit<Series,'bars'> {bars:readonly VcpBar[]}
export interface Swing {kind:'H'|'L';index:number;price:string;occurredAt:string;confirmedAt:string;session:string}
export interface Leg {high:Swing;low:Swing;depth:string;duration:number;meanVolume:string;cumulativeVolume:string;highCurrent:string;lowCurrent:string}
export interface Pattern {id:string;listingId:string;anchor:Swing;legs:Leg[];duration:number;pivot:string;pivotCurrent:string;rules:Record<string,'PASS'|'FAIL'|'UNKNOWN'>;stopSource:string|null;state:string;reasons:string[];asOf:string;decidedAt:string;dataRevision:string;adjustmentRevision:string;strategyVersion:string;algorithm:string;distance:string;vdu:string|null;atr:string|null}
function validate(s:VcpSeries){validateSeries(s);for(const b of s.bars)if(utcInstant(b.endedAt)>utcInstant(b.finalizedAt!))throw new Error('INVALID_BAR_TIMING')}
export function normalize(swings:readonly Swing[]):Swing[]{
 const result:Swing[]=[];for(const swing of swings){const prior=result.at(-1);if(!prior||prior.kind!==swing.kind){result.push(swing);continue}
 const cmp=Q.decimal(swing.price).compare(Q.decimal(prior.price));if((swing.kind==='H'&&cmp>0)||(swing.kind==='L'&&cmp<0))result[result.length-1]=swing;}
 return result;
}
export function extrema(s:VcpSeries){
 validate(s);const raw:Swing[]=[];const ambiguities:{index:number;confirmedAt:string;reason:string}[]=[];
 for(let i=3;i<s.bars.length-3;i++){
  const b=s.bars[i]!;let high=true,low=true;
  for(let j=i-3;j<=i+3;j++){if(j===i)continue;const other=s.bars[j]!;
   const h=Q.decimal(other.high).compare(Q.decimal(b.high));const l=Q.decimal(other.low).compare(Q.decimal(b.low));
   if(h>0||(h===0&&j<i))high=false;if(l<0||(l===0&&j<i))low=false;
  }
  const confirmedAt=s.bars[i+3]!.finalizedAt!;
  if(high&&low){ambiguities.push({index:i,confirmedAt,reason:'AMBIGUOUS_DUAL_EXTREMUM'});continue}
  if(high||low)raw.push({kind:high?'H':'L',index:i,price:high?b.high:b.low,occurredAt:b.endedAt,confirmedAt,session:b.session});
 }
 return {raw,swings:normalize(raw),ambiguities};
}
export function assembleLegs(s:VcpSeries,swings:readonly Swing[],factor='1'):Leg[]{
 const legs:Leg[]=[];const f=Q.decimal(factor);if(f.compare(new Q(0))<=0)throw new Error('INVALID_SCALE');
 for(let i=0;i+1<swings.length;i+=2){const h=swings[i]!,l=swings[i+1]!;if(h.kind!=='H'||l.kind!=='L'||h.index>=l.index)throw new Error('INVALID_LEG_ORDER');
 const volume=s.bars.slice(h.index,l.index+1).reduce((sum,b)=>sum+BigInt(b.volume),0n);
 legs.push({high:h,low:l,depth:new Q(100).mul(Q.decimal(h.price).sub(Q.decimal(l.price))).div(Q.decimal(h.price)).fixed(),duration:l.index-h.index+1,meanVolume:new Q(volume,l.index-h.index+1).fixed(),cumulativeVolume:volume.toString(),highCurrent:Q.decimal(h.price).mul(f).fixed(6),lowCurrent:Q.decimal(l.price).mul(f).fixed(6)});
 }return legs;
}
function depth(l:Leg){return new Q(100).mul(Q.decimal(l.high.price).sub(Q.decimal(l.low.price))).div(Q.decimal(l.high.price))}
export function validateLegs(legs:readonly Leg[],tick:string):string[]{
 const reasons:string[]=[];if(legs.length<2||legs.length>6)reasons.push('LEG_COUNT');
 if(!legs.length)return reasons;const t=Q.decimal(tick);if(t.compare(new Q(0))<=0)throw new Error('INVALID_TICK');
 for(let i=0;i<legs.length;i++){const leg=legs[i]!,d=depth(leg);
 if(d.compare(new Q(1))<0)reasons.push('DEPTH_BELOW_ONE');
 if(i===0&&d.compare(new Q(35))>0)reasons.push('FIRST_DEPTH_ABOVE_35');
 if(i===legs.length-1&&d.compare(new Q(12))>0)reasons.push('FINAL_DEPTH_ABOVE_12');
 if(i>0){const p=legs[i-1]!;
 if(d.compare(depth(p).mul(new Q(9,10)))>0)reasons.push('INSUFFICIENT_CONTRACTION');
 if(Q.decimal(leg.low.price).compare(Q.decimal(p.low.price))<=0)reasons.push('LOW_NOT_RISING');
 if(Q.decimal(leg.high.price).compare(Q.decimal(p.high.price).add(t))>0)reasons.push('HIGH_ABOVE_PREVIOUS');
 if(Q.decimal(leg.high.price).compare(Q.decimal(legs[0]!.high.price).add(t))>0)reasons.push('HIGH_ABOVE_ANCHOR');
 }}return [...new Set(reasons)];
}
export function patternId(listingId:string,anchor:Swing,tick:string,adjustmentRevision:string):string{
 const units=parseFixed(anchor.price),ticks=parseFixed(tick);if(ticks<=0n||units%ticks!==0n)throw new Error('ANCHOR_OFF_TICK');
 return createHash('sha256').update([listingId,anchor.occurredAt,(units/ticks).toString(),ALGORITHM,adjustmentRevision].join('|')).digest('hex');
}
export function fullBasePivot(s:VcpSeries,anchorIndex:number):string{
 if(anchorIndex<0||anchorIndex>=s.bars.length)throw new Error('INVALID_ANCHOR');
 return s.bars.slice(anchorIndex).map(b=>Q.decimal(b.high)).reduce((a,b)=>a.compare(b)>0?a:b).fixed(6);
}
export function selectPrimary(patterns:readonly Pattern[]):Pattern|null {
 return [...patterns].filter(p=>['READY','WATCH','WATCH_DATA'].includes(p.state)).sort((a,b)=>
 b.legs.length-a.legs.length||b.anchor.index-a.anchor.index||Q.decimal(a.legs.at(-1)!.depth).compare(Q.decimal(b.legs.at(-1)!.depth))||Q.decimal(a.distance).compare(Q.decimal(b.distance))||(a.id<b.id?-1:a.id>b.id?1:0))[0]??null;
}
export function detect(s:VcpSeries,input:{listingId:string;tick:string;adjustmentRevision:string;currentScaleFactor:string;rs:string|null;decidedAt:string}){
 validate(s);utcInstant(input.decidedAt);if(utcInstant(input.decidedAt)<utcInstant(s.asOf))throw new Error('DECISION_BEFORE_ASOF');
 const {swings,ambiguities}=extrema(s);const patterns:Pattern[]=[];const rejected:{anchorIndex:number;reason:string}[]=[];
 const volume=vdu(s),atr=atr14(s),tt=trendTemplate(s,input.rs);const close=Q.decimal(s.bars.at(-1)!.close);
 for(let k=0;k<swings.length;k++){const anchor=swings[k]!;if(anchor.kind!=='H')continue;const b=anchor.index,duration=s.bars.length-b;
 if(duration<10)continue;
 if(b<61){rejected.push({anchorIndex:b,reason:'PRETREND_WARMUP'});continue}
 const before=Q.decimal(s.bars[b-1]!.close),baseline=Q.decimal(s.bars[b-61]!.close);
 const sma50=s.bars.slice(b-50,b).reduce((sum,x)=>sum.add(Q.decimal(x.close)),new Q(0)).div(new Q(50));
 if(before.div(baseline).sub(new Q(1)).compare(new Q(1,5))<0||before.compare(sma50)<=0){rejected.push({anchorIndex:b,reason:'PRETREND_FAILED'});continue}
 const legs=assembleLegs(s,swings.slice(k),input.currentScaleFactor);const reasons=validateLegs(legs,input.tick);
 const pivot=fullBasePivot(s,b);const last=legs.at(-1);let state='WATCH';
 if(duration>90){state='EXPIRED';reasons.push('BASE_EXPIRED')}
 else if(legs.length===1){state='DEVELOPING'}
 else if(reasons.length){state='REJECTED'}
 else if(last&&s.bars.slice(last.low.index+4).some(bar=>Q.decimal(bar.close).compare(Q.decimal(last.low.price))<0)){state='INVALIDATED';reasons.push('CLOSE_BELOW_CONFIRMED_LOW')}
 else if(volume.state==='UNKNOWN'){state='WATCH_DATA';reasons.push('VDU_UNKNOWN')}
 else if(tt.value?.state==='PASS'&&close.compare(Q.decimal(pivot).mul(new Q(96,100)))>=0&&close.compare(Q.decimal(pivot))<=0&&Q.decimal(volume.value!).compare(new Q(4,5))<=0){state='READY'}
 else{if(tt.value?.state!=='PASS')reasons.push('TREND_TEMPLATE_'+(tt.value?.state??'UNKNOWN'));if(close.compare(Q.decimal(pivot).mul(new Q(96,100)))<0||close.compare(Q.decimal(pivot))>0)reasons.push('OUTSIDE_READY_ZONE');if(volume.value!==null&&Q.decimal(volume.value).compare(new Q(4,5))>0)reasons.push('VOLUME_NOT_DRY')}
 let id:string;try{id=patternId(input.listingId,anchor,input.tick,input.adjustmentRevision)}catch{rejected.push({anchorIndex:b,reason:'ANCHOR_OFF_TICK'});continue}
 const rules:Record<string,'PASS'|'FAIL'|'UNKNOWN'>={};for(const code of ['LEG_COUNT','DEPTH_BELOW_ONE','FIRST_DEPTH_ABOVE_35','FINAL_DEPTH_ABOVE_12','INSUFFICIENT_CONTRACTION','LOW_NOT_RISING','HIGH_ABOVE_PREVIOUS','HIGH_ABOVE_ANCHOR','BASE_EXPIRED','CLOSE_BELOW_CONFIRMED_LOW'])rules[code]=reasons.includes(code)?'FAIL':'PASS';for(const [index,state] of (tt.value?.predicates??Array(10).fill('UNKNOWN')).entries())rules['TT_'+(index+1)]=state;rules['VDU']=volume.value===null?'UNKNOWN':Q.decimal(volume.value).compare(new Q(4,5))<=0?'PASS':'FAIL';patterns.push({rules,pivotCurrent:Q.decimal(pivot).mul(Q.decimal(input.currentScaleFactor)).fixed(6),id,listingId:input.listingId,anchor,legs,duration,pivot,stopSource:last?.lowCurrent??null,state,reasons,asOf:s.asOf,decidedAt:input.decidedAt,dataRevision:s.dataRevision,adjustmentRevision:input.adjustmentRevision,strategyVersion:STRATEGY_VERSION,algorithm:ALGORITHM,distance:Q.decimal(pivot).sub(close).abs().fixed(),vdu:volume.value,atr:atr.value});
 }
 return {patterns,primary:selectPrimary(patterns),swings,ambiguities,rejected};
}
/** One event per canonical company/session/pivot band; retain linked nested evidence. */
export function deduplicateSignals(rows:readonly {companyId:string;session:string;pattern:Pattern}[],tick:string){
 const tolerance=Q.decimal(tick);if(tolerance.compare(new Q(0))<=0)throw new Error('INVALID_TICK');
 const groups:{id:string;companyId:string;session:string;pivot:string;primaryPatternId:string;secondaryPatternIds:string[]}[]=[];
 const sorted=[...rows].sort((a,b)=>a.companyId.localeCompare(b.companyId)||a.session.localeCompare(b.session)||Q.decimal(a.pattern.pivot).compare(Q.decimal(b.pattern.pivot))||a.pattern.id.localeCompare(b.pattern.id));
 for(const row of sorted){const existing=groups.find(g=>g.companyId===row.companyId&&g.session===row.session&&Q.decimal(g.pivot).sub(Q.decimal(row.pattern.pivot)).abs().compare(tolerance)<=0);
 if(existing){if(existing.primaryPatternId!==row.pattern.id&&!existing.secondaryPatternIds.includes(row.pattern.id))existing.secondaryPatternIds.push(row.pattern.id);continue}
 groups.push({id:createHash('sha256').update(row.companyId+'|'+row.session+'|'+row.pattern.pivot).digest('hex'),companyId:row.companyId,session:row.session,pivot:row.pattern.pivot,primaryPatternId:row.pattern.id,secondaryPatternIds:[]});
 }return groups;
}

