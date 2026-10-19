import {randomUUID} from 'node:crypto';
import {PrismaClient,prepareEodScan,eodScanProgress} from '../packages/database/dist/index.js';
const [session,calendarId,scanId=randomUUID(),...extra]=process.argv.slice(2);
if(!session||!calendarId||extra.length||!/^\d{4}-\d{2}-\d{2}$/.test(session)||!/^[0-9a-f]{64}$/.test(calendarId)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(scanId))throw new Error('Usage: node scripts/database-command.mjs scan YYYY-MM-DD CALENDAR_SHA256 [SCAN_UUID]');
const db=new PrismaClient();
try{
 const existing=await eodScanProgress(db,scanId);
 if(existing){if(existing.request.session!==session||existing.request.calendarId!==calendarId)throw new Error('SCAN_REQUEST_CONFLICT');console.log(JSON.stringify({scanId,intended:existing.intended,completed:existing.completed,status:existing.result?.status??'PENDING'}))}
 else {const plan=await prepareEodScan(db,{scanId,session,calendarId,asOf:new Date().toISOString()});console.log(JSON.stringify({scanId,intended:plan.items.length,dataRevision:plan.dataRevision,status:'PLANNED'}))}
}finally{await db.$disconnect()}
