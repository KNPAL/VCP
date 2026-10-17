import {createHash} from 'node:crypto';
import {rankCandidates,MARKET_STATE_ORDER} from './ranking.js';
import type {RankInput,ScanEvidence,MarketState} from './ranking.js';
export type ScanOutcome={instrumentId:string;status:'ANALYZED'|'MISSING'|'EXCLUDED';reasons:string[];candidate:RankInput|null};
export function completeScan(evidence:ScanEvidence,intended:readonly string[],outcomes:readonly ScanOutcome[]){
 if(new Set(intended).size!==intended.length||!intended.length)throw new Error('INVALID_INTENDED_UNIVERSE');
 const byId=new Map<string,ScanOutcome>();
 for(const item of outcomes){
  if(!intended.includes(item.instrumentId)||byId.has(item.instrumentId))throw new Error('INVALID_SCAN_OUTCOME');
  if(!['ANALYZED','MISSING','EXCLUDED'].includes(item.status))throw new Error('INVALID_SCAN_STATUS');
  if(item.status!=='ANALYZED'&&(!item.reasons.length||item.candidate!==null))throw new Error('MISSING_OUTCOME_REASON');
  if(item.status==='ANALYZED'&&(!item.candidate||item.candidate.instrumentId!==item.instrumentId))throw new Error('MISSING_CANDIDATE');
  byId.set(item.instrumentId,item);
 }
 const entries=[...intended].sort().map(instrumentId=>byId.get(instrumentId)??{instrumentId,status:'MISSING' as const,reasons:['NOT_PROCESSED'],candidate:null});
 const candidates=rankCandidates(entries.flatMap(x=>x.candidate?[x.candidate]:[]),evidence);
 const missing=entries.filter(x=>x.status==='MISSING').length,excluded=entries.filter(x=>x.status==='EXCLUDED').length;
 const analyzed=candidates.length,rejected=candidates.filter(x=>x.marketState==='REJECTED').length;
 return {...evidence,status:missing?(analyzed?'PARTIAL':'ERROR'):'COMPLETE',counts:{intended:intended.length,eligible:intended.length-excluded,analyzed,rejected,missing,excluded},entries,candidates};
}
export type CompletedScan=ReturnType<typeof completeScan>;
export function candidatePage(scan:CompletedScan,query:{state?:string;cursor?:string;limit?:number;sort?:string}={}){
 const limit=query.limit??50;if(!Number.isInteger(limit)||limit<1||limit>200)throw new Error('INVALID_PAGE_LIMIT');
 if(query.sort&&query.sort!=='rank')throw new Error('INVALID_SORT');
 if(query.state&&!MARKET_STATE_ORDER.includes(query.state as MarketState))throw new Error('UNKNOWN_MARKET_STATE');
 const identity=createHash('sha256').update(JSON.stringify([scan.scanId,scan.configHash,scan.dataRevision,query.state??null,'rank'])).digest('hex');
 let after=0;
 if(query.cursor){try{
  const decoded=JSON.parse(Buffer.from(query.cursor,'base64url').toString());
  if(decoded.identity!==identity||!Number.isSafeInteger(decoded.after)||decoded.after<1||!scan.candidates.some(x=>x.rank===decoded.after&&(!query.state||x.marketState===query.state)))throw new Error();
  after=decoded.after;
 }catch{throw new Error('INVALID_SCAN_CURSOR')}}
 const rows=scan.candidates.filter(x=>x.rank>after&&(!query.state||x.marketState===query.state));
 const items=rows.slice(0,limit);const nextCursor=rows.length>limit?Buffer.from(JSON.stringify({identity,after:items.at(-1)!.rank})).toString('base64url'):null;
 return {items,nextCursor,asOf:scan.asOf,dataRevision:scan.dataRevision,scanId:scan.scanId,configHash:scan.configHash};
}
