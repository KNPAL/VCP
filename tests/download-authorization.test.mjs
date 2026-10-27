import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {signDownloadPreview,verifyDownloadPreview,authorizeDownloadPreview} from '../packages/database/dist/index.js';
const owner=randomUUID(),key=randomBytes(32),now='2026-10-26T06:00:00.000Z';
function fixture(){return {checkedAt:now,expiresAt:'2026-10-26T06:05:00.000Z',request:{universeId:'NIFTY_500',interval:'1d',fromDate:'2025-01-01',toDate:'2025-01-03',mode:'MISSING_ONLY'},universeSnapshotId:'universe',instrumentSnapshotId:'instruments',sourceSnapshotId:'source',dataRevision:'data',blockedInstruments:[],items:[{listingId:'listing',calendarId:'calendar',state:'KNOWN',reasons:[],rangesToFetch:[{from:'2025-01-02',to:'2025-01-02',sessions:['2025-01-02']}],missingCount:1,alreadyStoredCount:2}],sourcePermissions:{DISPLAY:{status:'PASS'},DERIVE:{status:'PASS'},DOWNLOAD:{status:'PASS'},STORE:{status:'PASS'}},warnings:[]}}
test('signed preview is owner bound, tamper evident and expires exactly after five minutes',()=>{
 const preview=fixture(),token=signDownloadPreview(preview,owner,key);assert.equal(verifyDownloadPreview(token,owner,key,now).request.mode,'MISSING_ONLY');
 assert.throws(()=>verifyDownloadPreview(token,randomUUID(),key,now),/INVALID/);assert.throws(()=>verifyDownloadPreview(token,owner,randomBytes(32),now),/INVALID/);
 const parts=token.split('.'),payload=JSON.parse(Buffer.from(parts[0],'base64url').toString());payload.request.mode='RECONCILE';assert.throws(()=>verifyDownloadPreview(Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+parts[1],owner,key,now),/INVALID/);
 assert.throws(()=>verifyDownloadPreview(token,owner,key,'2026-10-26T06:05:00.000Z'),/EXPIRED/);assert.doesNotThrow(()=>verifyDownloadPreview(token,owner,key,'2026-10-26T06:04:59.999Z'));assert.throws(()=>verifyDownloadPreview(token,owner,key,'2026-10-26T05:59:59.999Z'),/INVALID/);
 for(const bad of ['',token+'.extra','x'.repeat(65537),'a.b'])assert.throws(()=>verifyDownloadPreview(bad,owner,key,now),/INVALID/);assert.throws(()=>signDownloadPreview(preview,owner,new Uint8Array(31)),/KEY_INVALID/);
});
test('current revisions, permissions, readiness and source ranges are revalidated independently of signature',()=>{
 const preview=fixture(),token=signDownloadPreview(preview,owner,key);assert.doesNotThrow(()=>authorizeDownloadPreview(token,owner,key,preview,now));
 for(const field of ['brokerConfigurationRevision','dataRevision','universeSnapshotId','instrumentSnapshotId','sourceSnapshotId'])assert.throws(()=>authorizeDownloadPreview(token,owner,key,{...preview,[field]:'changed'},now),/CHANGED/);
 assert.throws(()=>authorizeDownloadPreview(token,owner,key,{...preview,items:[{...preview.items[0],calendarId:'changed'}]},now),/CHANGED/);
 assert.throws(()=>authorizeDownloadPreview(token,owner,key,{...preview,sourcePermissions:{...preview.sourcePermissions,DOWNLOAD:{status:'FAIL'}}},now),/PREREQUISITES/);
 assert.throws(()=>authorizeDownloadPreview(token,owner,key,{...preview,warnings:['BROKER_HISTORY_UNAVAILABLE_LOCAL_PREVIEW_ONLY']},now),/PREREQUISITES/);
 assert.throws(()=>authorizeDownloadPreview(token,owner,key,preview,'2026-10-26T06:00:05.001Z'),/READINESS_STALE/);
 const later={...preview,checkedAt:'2026-10-26T06:00:01.000Z',expiresAt:'2026-10-26T06:05:01.000Z'};assert.doesNotThrow(()=>authorizeDownloadPreview(token,owner,key,later,later.checkedAt));
});
