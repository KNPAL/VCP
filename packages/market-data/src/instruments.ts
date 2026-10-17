import {parseFixed,integerShares,sessionDate,utcInstant,exchangeDate} from '@vcp/domain';
export interface InstrumentMapping {companyId:string;isin:string;listingId:string;exchange:'NSE'|'BSE';series:string;symbol:string;instrumentType:'EQUITY'|'ETF'|'INDEX'|'DERIVATIVE'|'UNKNOWN';tick:string;lot:number;listingDate:string;provider:string;token:string;validFrom:string;validTo:string|null;verified:boolean;enabled:boolean}
export interface InstrumentSnapshot {id:string;knownAt:string;sourceReference:string;rows:readonly InstrumentMapping[]}
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const effective=(from:string,to:string|null,date:string)=>from<=date&&(to===null||date<to);
export function validateInstrumentSnapshot(snapshot:InstrumentSnapshot){
 utcInstant(snapshot.knownAt);if(!snapshot.sourceReference||!snapshot.id)throw new Error('INSTRUMENT_SOURCE_REQUIRED');
 const identities=new Map<string,string>(),listings=new Map<string,string>(),ranges=new Map<string,InstrumentMapping[]>();
 for(const row of snapshot.rows){
  if(!uuid(row.companyId)||!uuid(row.listingId)||!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(row.isin)||!['NSE','BSE'].includes(row.exchange)||!row.symbol.trim()||!row.provider.trim()||!/^\d+$/.test(row.token)||BigInt(row.token)<=0n||parseFixed(row.tick)<=0n||integerShares(row.lot)===0)throw new Error('INVALID_INSTRUMENT_MAPPING');
  sessionDate(row.listingDate);sessionDate(row.validFrom);if(row.validTo){sessionDate(row.validTo);if(row.validTo<=row.validFrom)throw new Error('INVALID_EFFECTIVE_RANGE')}
  if(row.validFrom<row.listingDate)throw new Error('MAPPING_BEFORE_LISTING');
  const prior=identities.get(row.isin);if(prior&&prior!==row.companyId)throw new Error('CONFLICTING_COMPANY_IDENTITY');identities.set(row.isin,row.companyId);
  const listingIdentity=[row.companyId,row.isin,row.exchange].join('|'),priorListing=listings.get(row.listingId);if(priorListing&&priorListing!==listingIdentity)throw new Error('CONFLICTING_LISTING_IDENTITY');listings.set(row.listingId,listingIdentity);
  const key=row.listingId+'|'+row.provider,previous=ranges.get(key)??[];
  if(previous.some(other=>(row.validTo===null||other.validFrom<row.validTo)&&(other.validTo===null||row.validFrom<other.validTo)))throw new Error('OVERLAPPING_TOKEN_MAPPING');
  previous.push(row);ranges.set(key,previous);
 }
 return snapshot;
}
export function canonicalListings(snapshots:readonly InstrumentSnapshot[],intendedIsins:readonly string[],asOf:string){
 const cutoff=utcInstant(asOf).valueOf(),date=exchangeDate(asOf);
 const snapshot=[...snapshots].filter(item=>utcInstant(item.knownAt).valueOf()<=cutoff).sort((a,b)=>b.knownAt.localeCompare(a.knownAt)||a.id.localeCompare(b.id))[0];
 if(snapshot)validateInstrumentSnapshot(snapshot);
 return [...new Set(intendedIsins)].sort().map(isin=>{
  const rows=snapshot?.rows.filter(row=>row.isin===isin&&effective(row.validFrom,row.validTo,date))??[];
  const eligible=rows.filter(row=>row.verified&&row.enabled&&row.instrumentType==='EQUITY'&&((row.exchange==='NSE'&&row.series==='EQ')||(row.exchange==='BSE'&&row.series==='CASH')));
  const nse=eligible.filter(row=>row.exchange==='NSE'),options=nse.length?nse:eligible.filter(row=>row.exchange==='BSE');
  const primary=options.length===1?options[0]!:null;
  return {isin,primary,otherListings:rows.filter(row=>row.listingId!==primary?.listingId),status:primary?'KNOWN' as const:'UNKNOWN' as const,reason:primary?null:options.length>1?'AMBIGUOUS_CANONICAL_LISTING':rows.length?'NO_VERIFIED_CASH_EQUITY_LISTING':'INSTRUMENT_MAPPING_MISSING',snapshotId:snapshot?.id??null,asOf};
 });
}
export interface UniverseSnapshot {id:string;universe:'NIFTY_500';knownAt:string;effectiveFrom:string;effectiveTo:string|null;sourceReference:string;historicalConstituentsVerified:boolean;isins:readonly string[]}
export function universeAt(snapshots:readonly UniverseSnapshot[],asOf:string){
 const date=exchangeDate(asOf),cutoff=utcInstant(asOf).valueOf();
 if(snapshots.some(snapshot=>snapshot.universe!=='NIFTY_500'))throw new Error('UNSUPPORTED_UNIVERSE');
 for(const snapshot of snapshots){sessionDate(snapshot.effectiveFrom);if(snapshot.effectiveTo)sessionDate(snapshot.effectiveTo);if(snapshot.effectiveTo&&snapshot.effectiveTo<=snapshot.effectiveFrom)throw new Error('INVALID_UNIVERSE_RANGE');if(new Set(snapshot.isins).size!==snapshot.isins.length||snapshot.isins.some(isin=>!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)))throw new Error('INVALID_UNIVERSE_MEMBERS')}
 const selected=snapshots.filter(snapshot=>utcInstant(snapshot.knownAt).valueOf()<=cutoff&&effective(snapshot.effectiveFrom,snapshot.effectiveTo,date)).sort((a,b)=>b.knownAt.localeCompare(a.knownAt)||a.id.localeCompare(b.id))[0];
 if(!selected||!selected.sourceReference)return {state:'UNKNOWN' as const,reason:'UNIVERSE_HISTORY_MISSING',members:[],snapshotId:null,bias:'SURVIVORSHIP_BIASED_RESEARCH'};
 return {state:selected.historicalConstituentsVerified?'KNOWN' as const:'UNKNOWN' as const,reason:selected.historicalConstituentsVerified?null:'HISTORICAL_CONSTITUENTS_UNVERIFIED',members:[...selected.isins].sort(),snapshotId:selected.id,bias:selected.historicalConstituentsVerified?null:'SURVIVORSHIP_BIASED_RESEARCH'};
}
export interface SectorMapping {isin:string;sector:string;validFrom:string;validTo:string|null;knownAt:string;sourceReference:string}
export function sectorAt(mappings:readonly SectorMapping[],isin:string,asOf:string){
 const date=exchangeDate(asOf),cutoff=utcInstant(asOf).valueOf(),visible=mappings.filter(mapping=>mapping.isin===isin&&utcInstant(mapping.knownAt).valueOf()<=cutoff);
 for(const row of visible){sessionDate(row.validFrom);if(row.validTo)sessionDate(row.validTo);if(!row.sector.trim()||!row.sourceReference||(row.validTo&&row.validTo<=row.validFrom))throw new Error('INVALID_SECTOR_MAPPING')}
 for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){const a=visible[i]!,b=visible[j]!;if((a.validTo===null||b.validFrom<a.validTo)&&(b.validTo===null||a.validFrom<b.validTo))throw new Error('OVERLAPPING_SECTOR_MAPPING')}
 const current=visible.find(mapping=>effective(mapping.validFrom,mapping.validTo,date));
 return current?{status:'KNOWN',sector:current.sector,sourceReference:current.sourceReference}:{status:'UNKNOWN',sector:null,reason:'SECTOR_MAPPING_MISSING'};
}
