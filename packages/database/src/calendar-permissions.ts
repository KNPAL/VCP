import type {PrismaClient} from '@prisma/client';
import type {CalendarDay,Permission,SourceRecord} from '@vcp/market-data';
import {assertRegisteredSourceIds,lockSourceScope} from './source-authority.js';
type Reader=Pick<PrismaClient,'$queryRaw'>;
export async function assertCalendarPermissions(db:Reader,calendar:readonly CalendarDay[]|null,uses:readonly Permission[]){
 if(!Array.isArray(calendar))throw new Error('SOURCE_LINEAGE_MISSING');
 await assertRegisteredSourceIds(db,'EXCHANGE_CALENDAR',calendar.map(day=>day.sourceSnapshotId),uses);
}
export async function lockCalendarAuthority(db:Pick<PrismaClient,'$queryRaw'|'$executeRaw'>,calendar:readonly CalendarDay[]|null){
 if(!Array.isArray(calendar))throw new Error('SOURCE_LINEAGE_MISSING');
 const ids=[...new Set(calendar.map(day=>day.sourceSnapshotId))];
 if(ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))throw new Error('SOURCE_LINEAGE_MISSING');
 const rows=await db.$queryRaw<{evidence:SourceRecord}[]>`SELECT evidence FROM "SourceSnapshot" WHERE id=ANY(${ids as string[]}::text[]) ORDER BY dataset,evidence->>'provider',evidence->>'endpointOrFile'`;
 for(const row of rows)await lockSourceScope(db,row.evidence);
}
export async function authorizeCalendarRows<T extends {evidence:CalendarDay[]|null}>(db:Reader,rows:readonly T[]):Promise<T[]>{
 const result:T[]=[];
 for(const row of rows){
  try{await assertCalendarPermissions(db,row.evidence,['DERIVE','DISPLAY']);result.push(row)}
  catch(error){if(!(error instanceof Error)||!['SOURCE_PERMISSION_REQUIRED','SOURCE_LINEAGE_MISSING'].includes(error.message))throw error;result.push({...row,evidence:[]})}
 }return result;
}
