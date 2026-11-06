import {randomUUID} from 'node:crypto';
import {persistSource,persistUniverse,persistInstrumentSnapshot,persistHistoricalSnapshot,ingestCandles} from '../packages/database/dist/index.js';
const registeredIds=new WeakMap();
function sourceIdFor(db,source){if(!registeredIds.has(source))registeredIds.set(source,persistSource(db,source).then(row=>row.id));return registeredIds.get(source)}
export async function permittedCalendar(db,calendar){
 if(!Array.isArray(calendar))return calendar;
 for(const day of calendar)if(!day.sourceSnapshotId){const source=await sourceFor(db,'EXCHANGE_CALENDAR',{knownAt:day.knownAt,sourceReference:day.source});day.sourceSnapshotId=await sourceIdFor(db,source)}
 return calendar;
}
export async function permittedCandles(db,input,onCommit){await permittedCalendar(db,input.calendar);return ingestCandles(db,input,onCommit)}
export async function permittedHistoricalSnapshot(db,ownerId,requestId,input){
 for(const [dataset,records] of [['instrument-master',input.instruments],['UNIVERSE',input.universes]])for(const record of records)record.source??=await sourceFor(db,dataset,{...record,sourceReference:'archive:'+record.sourceReference});
 for(const [dataset,records] of [['EXCHANGE_CALENDAR',input.calendar],['CORPORATE_ACTIONS',input.actions]]){
  if(records.some(record=>!record.sourceSnapshotId)){
   const source=await sourceFor(db,dataset,input),{id}=await persistSource(db,source);
   for(const record of records)record.sourceSnapshotId??=id;
  }
 }
 return persistHistoricalSnapshot(db,ownerId,requestId,input);
}
const sources=new WeakMap();
function sourceFor(db,dataset,input){
 let scoped=sources.get(db);if(!scoped){scoped=new Map();sources.set(db,scoped)}
 const key=JSON.stringify([dataset,input.knownAt,input.sourceReference]);
 if(!scoped.has(key))scoped.set(key,referenceSource(db,dataset,input.knownAt));
 return scoped.get(key);
}
export async function permittedInstruments(db,input){return persistInstrumentSnapshot(db,{...input,source:input.source??await sourceFor(db,'instrument-master',input)})}
export async function permittedUniverse(db,input){return persistUniverse(db,{...input,source:input.source??await sourceFor(db,'UNIVERSE',input)})}
export async function referenceSource(db,dataset,knownAt=new Date(Date.now()-1000).toISOString()){
 const source={dataset,provider:'synthetic-'+randomUUID(),endpointOrFile:'test-only',licenseRef:'synthetic-only',uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false},updateFrequency:'daily',asOf:knownAt,knownAt,effectiveAt:knownAt,validUntil:new Date(Date.now()+3600000).toISOString(),lastVerified:knownAt,maximumAgeMs:Math.max(3600000,Date.now()-Date.parse(knownAt)+3600000),adjustmentPolicy:'synthetic',coverage:{intended:1,available:1},error:null};
 await persistSource(db,source);return source;
}
