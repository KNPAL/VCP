import {randomUUID} from 'node:crypto';
import {persistSource,persistUniverse,persistInstrumentSnapshot} from '../packages/database/dist/index.js';
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
