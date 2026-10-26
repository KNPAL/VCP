import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';
import {validateDownloadPreviewRequest,type readDownloadPreview} from './download-preview.js';
type Preview=Awaited<ReturnType<typeof readDownloadPreview>>;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function binding(preview:Preview){
 return createHash('sha256').update(canonical({request:preview.request,universeSnapshotId:preview.universeSnapshotId,instrumentSnapshotId:preview.instrumentSnapshotId,sourceSnapshotId:preview.sourceSnapshotId,dataRevision:preview.dataRevision,blockedInstruments:preview.blockedInstruments,items:preview.items.map(i=>({listingId:i.listingId,calendarId:i.calendarId,state:i.state,reasons:i.reasons,rangesToFetch:i.rangesToFetch,missingCount:i.missingCount,alreadyStoredCount:i.alreadyStoredCount}))})).digest('hex');
}
function signingKey(key:Uint8Array){if(key.byteLength!==32)throw new Error('DOWNLOAD_PREVIEW_KEY_INVALID');return key}
/** Five-minute, owner-bound evidence authorization. No database write or download dispatch. */
export function signDownloadPreview(preview:Preview,ownerId:string,key:Uint8Array){
 if(!uuid.test(ownerId))throw new Error('DOWNLOAD_PREVIEW_OWNER_INVALID');
 const issued=utcInstant(preview.checkedAt).valueOf(),expires=utcInstant(preview.expiresAt).valueOf();
 if(expires-issued!==300000)throw new Error('DOWNLOAD_PREVIEW_EXPIRY_INVALID');
 const payload=Buffer.from(canonical({version:1,ownerId,request:validateDownloadPreviewRequest(preview.request),issuedAt:preview.checkedAt,expiresAt:preview.expiresAt,binding:binding(preview)})).toString('base64url');
 return payload+'.'+createHmac('sha256',signingKey(key)).update(payload).digest('base64url');
}
export function verifyDownloadPreview(token:string,ownerId:string,key:Uint8Array,now=new Date().toISOString()){
 signingKey(key);if(typeof token!=='string'||token.length>65536)throw new Error('DOWNLOAD_PREVIEW_INVALID');
 const parts=token.split('.');if(parts.length!==2||parts.some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))throw new Error('DOWNLOAD_PREVIEW_INVALID');
 const expected=createHmac('sha256',key).update(parts[0]!).digest(),actual=Buffer.from(parts[1]!,'base64url');
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('DOWNLOAD_PREVIEW_INVALID');
 let proof:{version:number;ownerId:string;request:unknown;issuedAt:string;expiresAt:string;binding:string};
 try{proof=JSON.parse(Buffer.from(parts[0]!,'base64url').toString('utf8'));if(!proof||proof.version!==1||!uuid.test(proof.ownerId)||!/^[a-f0-9]{64}$/.test(proof.binding))throw new Error();validateDownloadPreviewRequest(proof.request);utcInstant(proof.issuedAt);utcInstant(proof.expiresAt)}catch{throw new Error('DOWNLOAD_PREVIEW_INVALID')}
 if(proof.ownerId!==ownerId)throw new Error('DOWNLOAD_PREVIEW_INVALID');
 const at=utcInstant(now).valueOf(),issued=Date.parse(proof.issuedAt),expires=Date.parse(proof.expiresAt);
 if(issued>at||expires-issued!==300000)throw new Error('DOWNLOAD_PREVIEW_INVALID');
 if(expires<=at)throw new Error('DOWNLOAD_PREVIEW_EXPIRED');
 return {...proof,request:validateDownloadPreviewRequest(proof.request)};
}
/** Re-read evidence and current readiness before enqueueing; a valid signature alone is insufficient. */
export function authorizeDownloadPreview(token:string,ownerId:string,key:Uint8Array,current:Preview,now=new Date().toISOString()){
 const proof=verifyDownloadPreview(token,ownerId,key,now);
 if(proof.binding!==binding(current))throw new Error('DOWNLOAD_PREVIEW_CHANGED');
 if(!current.items.length||current.blockedInstruments.length||current.items.some(i=>i.state!=='KNOWN')||Object.values(current.sourcePermissions).some(p=>p.status!=='PASS')||current.warnings.includes('BROKER_HISTORY_UNAVAILABLE_LOCAL_PREVIEW_ONLY'))throw new Error('DOWNLOAD_PREREQUISITES_UNAVAILABLE');
 const checked=utcInstant(current.checkedAt).valueOf(),at=utcInstant(now).valueOf();
 if(checked>at||at-checked>5000)throw new Error('DOWNLOAD_READINESS_STALE');
 return proof;
}
