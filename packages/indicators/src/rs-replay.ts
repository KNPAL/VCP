import {relativeStrength,percentiles,type Series} from './index.js';
/** Every percentile is computed across the intended membership, using only that prefix. */
export function replayRelativeStrength(input:{benchmark:Series;members:Readonly<Record<string,Series|null>>;intended:readonly string[];sessions:readonly string[]}){
 return input.sessions.map((session,index)=>{
  const sessions=input.sessions.slice(0,index+1);
  const prefix=(series:Series):Series=>({...series,sessions,bars:series.bars.filter(b=>b.session<=session)});
  const benchmark=prefix(input.benchmark);
  const raw=input.intended.map(isin=>{
   const source=input.members[isin];
   const evidence=source?relativeStrength(prefix(source),benchmark):null;
   return {isin,value:evidence?.state==='KNOWN'?evidence.value!.raw:null,reason:evidence?.reason??(source?null:'MEMBER_SERIES_MISSING')};
  });
  const ranked=percentiles(input.intended,raw);
  return {session,state:ranked.state,reason:ranked.reason,values:ranked.values as Record<string,string|null>,raw,comparable:raw.filter(r=>r.value!==null).length,intended:input.intended.length};
 });
}
