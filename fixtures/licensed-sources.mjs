import {randomUUID} from 'node:crypto';
import {persistSource,LICENSE_SOURCE_ROLES} from '../packages/database/dist/index.js';
export async function licensedSources(db,knownAt,expiresAt){
 const scope=randomUUID(),sourceBindings=[];
 for(const role of LICENSE_SOURCE_ROLES){const source=await persistSource(db,{dataset:role,provider:'synthetic-'+scope,endpointOrFile:'fixture:'+role,licenseRef:'synthetic-only',uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false},updateFrequency:'daily',asOf:knownAt,knownAt,effectiveAt:knownAt,validUntil:expiresAt,lastVerified:knownAt,maximumAgeMs:Math.max(1,Date.parse(expiresAt)-Date.parse(knownAt)),adjustmentPolicy:'synthetic',coverage:{intended:1,available:1},error:null});sourceBindings.push({role,sourceSnapshotId:source.id})}
 return {sourceBindings};
}
