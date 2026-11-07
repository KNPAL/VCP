import type {PrismaClient} from '@prisma/client';
import type {CalendarDay,SourceRecord} from '@vcp/market-data';
import {lockProviderAuthority,registeredSourceReasons} from './source-authority.js';
import {assertCandlePermissions,assertActionPermissions} from './data-permissions.js';

type Transaction=Pick<PrismaClient,'$queryRaw'|'$executeRaw'>;
/** Call inside the write transaction; registry writers wait until that transaction ends. */
export async function lockDerivedAuthority(db:Transaction,input:{rawRevisionIds:readonly string[];adjustmentIds?:readonly string[];sources?:readonly SourceRecord[];calendar?:readonly CalendarDay[]}){
 const rawIds=[...new Set(input.rawRevisionIds)];
 const raw=rawIds.length?await db.$queryRaw<{source:string}[]>`SELECT source FROM "CandleRevision" WHERE id=ANY(${rawIds}::uuid[])`:[];
 if(raw.length!==rawIds.length)throw new Error('SOURCE_LINEAGE_MISSING');
 const adjustments=[...new Set(input.adjustmentIds??[])];
 const actions=adjustments.length?await db.$queryRaw<{sourceId:string|null}[]>`SELECT evidence->'source'->>'sourceSnapshotId' AS "sourceId" FROM "AdjustmentSnapshot" WHERE id=ANY(${adjustments}::text[])`:[];
 if(actions.length!==adjustments.length)throw new Error('SOURCE_LINEAGE_MISSING');
 const ids=[...new Set([...actions.map(row=>row.sourceId),...(input.calendar??[]).map(day=>day.sourceSnapshotId)])];
 if(ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))throw new Error('SOURCE_LINEAGE_MISSING');
 const records=ids.length?await db.$queryRaw<{evidence:SourceRecord}[]>`SELECT evidence FROM "SourceSnapshot" WHERE id=ANY(${ids as string[]}::text[])`:[];
 if(records.length!==ids.length)throw new Error('SOURCE_PERMISSION_REQUIRED');
 const sources=[...(input.sources??[]),...records.map(row=>row.evidence)];
 const scopes=[...sources,...raw.map(row=>({dataset:'DAILY_CANDLES',provider:row.source}))];
 // One ordering across all datasets avoids opposing multi-source lock acquisition.
 for(const dataset of [...new Set(scopes.map(scope=>scope.dataset))].sort())await lockProviderAuthority(db,dataset,scopes.filter(scope=>scope.dataset===dataset).map(scope=>scope.provider),'READ');
 if(rawIds.length)await assertCandlePermissions(db,rawIds,['DERIVE','STORE']);
 await assertActionPermissions(db,adjustments,['DERIVE','STORE']);
 for(const source of sources)if((await registeredSourceReasons(db,source,['DERIVE','STORE'],new Date().toISOString())).length)throw new Error('SOURCE_PERMISSION_REQUIRED');
}
