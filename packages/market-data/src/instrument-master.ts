import {parseFixed,formatFixed,utcInstant,exchangeDate} from '@vcp/domain';
import {sourcePermission,type SourceRecord} from './readiness.js';
import {validateInstrumentSnapshot,type InstrumentMapping} from './instruments.js';
export type MasterImport={source:SourceRecord;knownAt:string;tickDivisor:'1'|'100';mappings:InstrumentMapping[];records:unknown[]};
/** Raw SmartAPI JSON needs independent identity/type and tick-unit verification. */
export function normalizeInstrumentMaster(input:MasterImport,asOf:string){
 if(!input||!Array.isArray(input.records)||!Array.isArray(input.mappings)||!['1','100'].includes(input.tickDivisor))throw new Error('INVALID_MASTER_INPUT');
 if(utcInstant(input.knownAt)>utcInstant(asOf)||utcInstant(input.source.knownAt)>utcInstant(input.knownAt))throw new Error('MASTER_NOT_YET_KNOWN');
 for(const use of ['STORE','DERIVE'] as const)if(sourcePermission(input.source,use,asOf).status!=='PASS'||input.source.uses[use]!==true)throw new Error('MASTER_SOURCE_NOT_PERMITTED');
 validateInstrumentSnapshot({id:'review',knownAt:input.knownAt,sourceReference:input.source.endpointOrFile,rows:input.mappings});
 if(input.mappings.some(row=>row.provider!==input.source.provider))throw new Error('MASTER_PROVIDER_MISMATCH');
 const rows:InstrumentMapping[]=[],report:{row:number;status:'ACCEPTED'|'EXCLUDED'|'ERROR';reason:string}[]=[],seen=new Map<string,number[]>(),mappingIndex=new Map<string,InstrumentMapping[]>(),date=exchangeDate(input.knownAt);
 for(const row of input.mappings)if(row.validFrom<=date&&(row.validTo===null||date<row.validTo)){const key=row.exchange+':'+BigInt(row.token).toString();mappingIndex.set(key,[...(mappingIndex.get(key)??[]),row])}
 for(const [index,value] of input.records.entries()){
  const fail=(reason:string,status:'EXCLUDED'|'ERROR'='ERROR')=>report.push({row:index,status,reason});
  if(!value||typeof value!=='object'||Array.isArray(value)){fail('INVALID_MASTER_ROW');continue}
  const raw=value as Record<string,unknown>,text=(key:string)=>typeof raw[key]==='string'?(raw[key] as string).trim():null;
  const segment=text('exch_seg')?.toUpperCase(),exchange=segment==='NSE'||segment==='NSE_CM'?'NSE':segment==='BSE'||segment==='BSE_CM'?'BSE':null;
  if(!exchange){fail('UNSUPPORTED_SEGMENT','EXCLUDED');continue}
  const type=text('instrumenttype');if(type!==''&&type!=='EQ'){fail('UNSUPPORTED_INSTRUMENT_TYPE','EXCLUDED');continue}
  const token=text('token'),symbol=text('symbol');if(!token||!/^\d+$/.test(token)||BigInt(token)<=0n||!symbol){fail('INVALID_TOKEN_OR_SYMBOL');continue}
  const normalizedToken=BigInt(token).toString(),key=exchange+':'+normalizedToken;seen.set(key,[...(seen.get(key)??[]),index]);
  const matches=mappingIndex.get(key)??[];
  if(matches.length!==1){fail(matches.length?'AMBIGUOUS_MASTER_MAPPING':'MASTER_MAPPING_MISSING');continue}
  const mapping=matches[0]!;
  if(mapping.instrumentType!=='EQUITY'||!((exchange==='NSE'&&mapping.series==='EQ')||(exchange==='BSE'&&mapping.series==='CASH'))){fail('NOT_CASH_EQUITY','EXCLUDED');continue}
  if(mapping.verified!==true||mapping.enabled!==true){fail('MASTER_MAPPING_UNVERIFIED');continue}
  if(symbol!==mapping.symbol||text('expiry')!==''){fail('MASTER_IDENTITY_MISMATCH');continue}
  try{
   const tick=text('tick_size'),lot=text('lotsize');if(!tick||!lot||!/^\d+$/.test(lot))throw new Error();
   const scaled=parseFixed(tick),divisor=BigInt(input.tickDivisor);
   if(scaled<=0n||scaled%divisor!==0n||scaled/divisor!==parseFixed(mapping.tick)||BigInt(lot)!==BigInt(mapping.lot))throw new Error();
   rows.push({...mapping,token:normalizedToken,tick:formatFixed(scaled/divisor)});report.push({row:index,status:'ACCEPTED',reason:'VERIFIED_CASH_EQUITY'});
  }catch{fail('MASTER_TICK_OR_LOT_MISMATCH')}
 }
 const duplicateKeys=new Set([...seen].filter(([,indices])=>indices.length>1).map(([key])=>key));
 for(const indices of [...seen].filter(([key])=>duplicateKeys.has(key)).map(([,indices])=>indices))for(const index of indices){const item=report[index]!;item.status='ERROR';item.reason='DUPLICATE_PROVIDER_TOKEN'}
 const accepted=rows.filter(row=>!duplicateKeys.has(row.exchange+':'+row.token));
 return {knownAt:input.knownAt,rows:accepted,report,counts:{total:input.records.length,accepted:accepted.length,excluded:report.filter(r=>r.status==='EXCLUDED').length,errors:report.filter(r=>r.status==='ERROR').length},status:report.some(r=>r.status==='ERROR')?'PARTIAL':'VALIDATED'};
}
