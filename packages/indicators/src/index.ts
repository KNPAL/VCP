import {STRATEGY_VERSION,utcInstant,sessionDate} from '@vcp/domain';
import {Q,mean,max,min,median} from './rational.js';
export {Q} from './rational.js';
export {snapshot,replay} from './replay.js';
export {replayRelativeStrength} from './rs-replay.js';
export {validate as validateSeries};
export interface Bar {session:string;open:string;high:string;low:string;close:string;volume:string;revision:string;finalizedAt:string|null;adjustmentVerified:boolean}
export interface Series {priceScale?:'RAW'|'ADJUSTED';bars:readonly Bar[];sessions:readonly string[];asOf:string;dataRevision:string}
export interface Evidence<T> {state:'KNOWN'|'UNKNOWN';value:T|null;reason:string|null;asOf:string;strategyVersion:typeof STRATEGY_VERSION;dataRevision:string;sourceRevisions:string[]}
function result<T>(s:Series,fn:()=>T,scale:'RAW'|'ADJUSTED'='ADJUSTED'):Evidence<T>{try{validate(s,scale);return {state:'KNOWN',value:fn(),reason:null,asOf:s.asOf,strategyVersion:STRATEGY_VERSION,dataRevision:s.dataRevision,sourceRevisions:s.bars.map(b=>b.revision)}}catch(e){return {state:'UNKNOWN',value:null,reason:e instanceof Error?e.message:'INVALID_INPUT',asOf:s.asOf,strategyVersion:STRATEGY_VERSION,dataRevision:s.dataRevision,sourceRevisions:s.bars.map(b=>b.revision)}}}
function validate(s:Series,scale:'RAW'|'ADJUSTED'='ADJUSTED'){if((s.priceScale??'ADJUSTED')!==scale)throw new Error('WRONG_PRICE_SCALE');const cutoff=utcInstant(s.asOf).valueOf();if(!s.dataRevision||s.bars.length!==s.sessions.length||!s.bars.length)throw new Error('DATA_INCOMPLETE');for(let i=0;i<s.bars.length;i++){const b=s.bars[i]!;sessionDate(b.session);if(b.session!==s.sessions[i]||(i>0&&b.session<=s.bars[i-1]!.session)||!b.revision||!b.finalizedAt||utcInstant(b.finalizedAt).valueOf()>cutoff||(scale==='ADJUSTED'&&!b.adjustmentVerified))throw new Error('DATA_INCOMPLETE');const [o,h,l,c]=[b.open,b.high,b.low,b.close].map(Q.decimal);if(l!.compare(new Q(0))<=0||h!.compare(l!)<0||o!.compare(l!)<0||o!.compare(h!)>0||c!.compare(l!)<0||c!.compare(h!)>0||(scale==='RAW'?!/^\d+$/.test(b.volume):Q.decimal(b.volume).compare(new Q(0))<0))throw new Error('INVALID_BAR')}}
function window<T>(v:readonly T[],n:number){if(!Number.isSafeInteger(n)||n<=0||v.length<n)throw new Error('WARMUP_INCOMPLETE');return v.slice(-n)}
const closes=(s:Series)=>s.bars.map(b=>Q.decimal(b.close));
const volumes=(s:Series)=>s.bars.map(b=>Q.decimal(b.volume));
function smaValue(v:Q[],n:number){return mean(window(v,n))}
function emaValue(v:Q[],n:number){window(v,n);let prior=mean(v.slice(0,n));for(const c of v.slice(n))prior=c.mul(new Q(2,n+1)).add(prior.mul(new Q(n-1,n+1)));return prior}
function trValues(s:Series){return s.bars.slice(1).map((b,i)=>{const h=Q.decimal(b.high),l=Q.decimal(b.low),p=Q.decimal(s.bars[i]!.close);return max([h.sub(l),h.sub(p).abs(),l.sub(p).abs()])})}
function atrValues(s:Series){const tr=trValues(s);window(tr,14);let prior=mean(tr.slice(0,14));const values=[prior];for(const t of tr.slice(14)){prior=prior.mul(new Q(13)).add(t).div(new Q(14));values.push(prior)}return values}
export function sma(s:Series,n:20|50|150|200){return result(s,()=>smaValue(closes(s),n).fixed())}
export function ema21(s:Series){return result(s,()=>emaValue(closes(s),21).fixed())}
export function trueRange(s:Series){return result(s,()=>window(trValues(s),1)[0]!.fixed())}
export function atr14(s:Series){return result(s,()=>window(atrValues(s),1)[0]!.fixed())}
export function natr(s:Series){return result(s,()=>window(atrValues(s),1)[0]!.mul(new Q(100)).div(closes(s).at(-1)!).fixed())}
export function atrCompression(s:Series){return result(s,()=>{const a=window(atrValues(s),21);return a[20]!.div(mean(a.slice(0,20))).fixed()})}
export function vdu(s:Series){return result(s,()=>{const v=window(volumes(s),20);return mean(v.slice(-5)).div(mean(v)).fixed()})}
export function rvol(s:Series,n:20|50=50){return result(s,()=>{const v=window(volumes(s),n+1);return v[n]!.div(mean(v.slice(0,n))).fixed()})}
export function range52(s:Series){return result(s,()=>{const b=window(s.bars,252);return {high:max(b.map(b=>Q.decimal(b.high))).fixed(),low:min(b.map(b=>Q.decimal(b.low))).fixed()}})}
export function trendTemplate(s:Series,rs:string|null){return result(s,()=>{
 const c=closes(s),last=c.at(-1)!;
 const compare=(fn:()=>boolean):'PASS'|'FAIL'|'UNKNOWN'=>{try{return fn()?'PASS':'FAIL'}catch{return 'UNKNOWN'}};
 const p=[
 ()=>last.compare(smaValue(c,50))>0,()=>last.compare(smaValue(c,150))>0,()=>last.compare(smaValue(c,200))>0,
 ()=>smaValue(c,50).compare(smaValue(c,150))>0,()=>smaValue(c,50).compare(smaValue(c,200))>0,()=>smaValue(c,150).compare(smaValue(c,200))>0,
 ()=>smaValue(c,200).compare(smaValue(c.slice(0,-30),200))>0,
 ()=>last.compare(min(window(s.bars,252).map(b=>Q.decimal(b.low))).mul(new Q(130,100)))>=0,
 ()=>last.compare(max(window(s.bars,252).map(b=>Q.decimal(b.high))).mul(new Q(75,100)))>=0,
 ()=>{if(rs===null)throw new Error('RS_UNKNOWN');return Q.decimal(rs).compare(new Q(70))>0}
 ].map(compare);
 return {predicates:p,state:p.includes('UNKNOWN')?'UNKNOWN':p.every(p=>p==='PASS')?'PASS':'FAIL',buyStrength:rs===null?'UNKNOWN':Q.decimal(rs).compare(new Q(80))>=0?'PASS':'FAIL'};
})}
export function relativeStrength(stock:Series,benchmark:Series){return result(stock,()=>{validate(benchmark);if(stock.asOf!==benchmark.asOf||stock.sessions.join('|')!==benchmark.sessions.join('|'))throw new Error('UNALIGNED_BENCHMARK');const c=closes(stock),b=closes(benchmark);window(c,251);let total=new Q(0);const excess:Record<string,string>={};for(const [h,w] of [[20,20],[60,30],[120,30],[250,20]] as const){const value=c.at(-1)!.div(c.at(-1-h)!).div(b.at(-1)!.div(b.at(-1-h)!)).sub(new Q(1));excess[h]=value.fixed();total=total.add(value.mul(new Q(w,100)))}return {raw:total.fixed(),excess,benchmarkRevision:benchmark.dataRevision}})}
export function percentiles(intended:readonly string[],raw:readonly {isin:string;value:string|null}[]){
 const members=[...new Set(intended)];const values=new Map<string,Q>();let invalid=false;
 for(const row of raw){if(!members.includes(row.isin))continue;if(values.has(row.isin)){if(row.value!==null&&values.get(row.isin)!.compare(Q.decimal(row.value))!==0)invalid=true;continue}if(row.value!==null)values.set(row.isin,Q.decimal(Q.decimal(row.value).fixed(8)))}
 if(invalid||!members.length||values.size*5<members.length*4)return {state:'UNKNOWN' as const,reason:'INSUFFICIENT_COMPARABLE_COVERAGE',values:{}};
 const output:Record<string,string|null>={};
 for(const id of members){const v=values.get(id);if(!v){output[id]=null;continue}let less=0,equal=0;for(const other of values.values()){const cmp=other.compare(v);if(cmp<0)less++;if(cmp===0)equal++}output[id]=new Q(100*(2*less+equal),2*values.size).fixed()}
 return {state:'KNOWN' as const,reason:null,values:output};
}
export function marketRegime(indexClose:string|null,sma50:string|null,sma200:string|null,intended:readonly string[],rows:readonly {isin:string;close:string|null;sma50:string|null}[]){
 const members=[...new Set(intended)];const valid=new Map<string,{close:Q;sma:Q}>();
 for(const r of rows)if(members.includes(r.isin)&&r.close!==null&&r.sma50!==null)valid.set(r.isin,{close:Q.decimal(r.close),sma:Q.decimal(r.sma50)});
 if(!members.length||valid.size*5<members.length*4||indexClose===null||sma50===null||sma200===null)return {regime:'UNKNOWN',score:null,breadth:null,multiplier:'0'};
 const above=[...valid.values()].filter(r=>r.close.compare(r.sma)>0).length;const breadth=new Q(above,valid.size);
 const score=new Q(Q.decimal(indexClose).compare(Q.decimal(sma50))>0?35:0,10).add(new Q(Q.decimal(sma50).compare(Q.decimal(sma200))>0?25:0,10)).add(breadth.mul(new Q(4)));
 const regime=score.compare(new Q(75,10))>=0?'GREEN':score.compare(new Q(5))>=0?'YELLOW':'RED';return {regime,score:score.fixed(),breadth:breadth.fixed(),multiplier:regime==='GREEN'?'1':regime==='YELLOW'?'0.5':'0'};
}
export function adv20(raw:Series){return result(raw,()=>{const value=median(window(raw.bars,20).map(b=>Q.decimal(b.close).mul(new Q(BigInt(b.volume)))));return {median:value.fixed(6),eligible:value.compare(new Q(200000000))>=0}},'RAW')}
export function sectorContext(stockReturns:readonly string[]|null,benchmarkReturn:string|null){if(!stockReturns?.length||benchmarkReturn===null)return {state:'UNKNOWN',value:null};return {state:'KNOWN',value:median(stockReturns.map(Q.decimal)).sub(Q.decimal(benchmarkReturn)).fixed(),informational:true}}
