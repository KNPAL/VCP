import type {ActionSnapshot} from '@vcp/market-data';
import type {PrismaClient} from '@prisma/client';
import {utcInstant} from '@vcp/domain';
import {positionEpisodes} from '@vcp/portfolio';
import {readPortfolio} from './portfolio.js';
import {cashAllocations} from './cash-allocation.js';
import {readPositionCards} from './position-cards.js';
import {getDailyStructure} from './daily-structure.js';
import type {InitialStop} from './protective-stops.js';
// Validate calendar timestamps at millisecond precision while retaining the original microseconds for SQL keyset pagination.
const cursorInstant=(value:string)=>utcInstant(value.replace(/(\.\d{3})\d{3}Z$/, '$1Z'));
const validIsin=(isin:string)=>{if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin))throw new Error('INVALID_ISIN')};
export async function readPositionDetail(db:PrismaClient,ownerId:string,isin:string){
 validIsin(isin);
 const [journal,allocations,cards,stops]=await Promise.all([readPortfolio(db,ownerId),cashAllocations(db,ownerId),readPositionCards(db,ownerId),db.$queryRaw<{evidence:InitialStop}[]>`SELECT "evidence" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid AND "isin"=${isin}`]);
 const episodes=positionEpisodes(journal.events,journal.asOf,allocations).episodes.filter(e=>e.isin===isin),ids=new Set(episodes.flatMap(e=>e.fillIds)),cashIds=new Set(allocations.filter(a=>episodes.some(e=>e.id===a.episodeId)).map(a=>a.cashEventId));
 // Original and reversed records remain visible even though they no longer contribute to positions.
 const fillIds=new Set(journal.events.filter(e=>e.kind==='FILL'&&e.isin===isin).map(e=>e.id));
 const events=journal.events.filter(e=>fillIds.has(e.id)||cashIds.has(e.id)||e.kind==='REVERSAL'&&fillIds.has(e.targetId));
 const pivots=await Promise.all(stops.map(async ({evidence})=>{const source=evidence.sourceId?await getDailyStructure(db,evidence.sourceId):null;return {stopId:evidence.id,sourceId:evidence.sourceId,pivot:source?.detector.frozen.primary?.pivot??null,listingId:evidence.stop?.listingId??source?.input.listingId??null}}));
 const listings=[...new Set(pivots.flatMap(p=>p.listingId?[p.listingId]:[]))];
 const actions=listings.length?await db.$queryRaw<{id:string;evidence:{source:ActionSnapshot}}[]>`SELECT DISTINCT ON ("listingId") "id","evidence" FROM "AdjustmentSnapshot" WHERE "listingId"=ANY(${listings}::uuid[]) AND "asOf"<=${new Date(journal.asOf)} AND "createdAt"<=${new Date(journal.asOf)} ORDER BY "listingId","asOf" DESC,"createdAt" DESC,"id"`:[];
 const corporateActions=actions.flatMap(row=>row.evidence.source?.verified?row.evidence.source.actions.filter(a=>a.verified&&a.knownAt<=journal.asOf&&a.effectiveAt<=journal.asOf).map(a=>({...a,sourceRevision:row.id})):[]);
 return {isin,asOf:journal.asOf,validUntil:cards.validUntil,riskSnapshotId:cards.riskSnapshotId,current:cards.items.find(i=>i.isin===isin)??null,episodes,events,lots:journal.lots.filter(l=>l.isin===isin),realized:journal.realized.filter(r=>r.isin===isin),reversed:journal.reversed.filter(id=>fillIds.has(id)),activeFillIds:[...ids],allocations:allocations.filter(a=>episodes.some(e=>e.id===a.episodeId)),pivots,corporateActions,corporateActionState:actions.length&&actions.every(a=>a.evidence.source?.verified)?'KNOWN':'UNKNOWN',executable:false};
}
export async function positionTimeline(db:PrismaClient,ownerId:string,isin:string,cursor?:string){
 validIsin(isin);
 let cutoff=new Date().toISOString(),before=cutoff,kind='~',id='~';
 if(cursor){try{if(cursor.length>2000)throw new Error();const parsed=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')) as {isin:string;cutoff:string;before:string;kind:string;id:string};if(parsed.isin!==isin||typeof parsed.kind!=='string'||typeof parsed.id!=='string'||parsed.kind.length>50||parsed.id.length>100||utcInstant(parsed.cutoff)>new Date()||cursorInstant(parsed.before)>utcInstant(parsed.cutoff))throw new Error();({cutoff,before,kind,id}=parsed)}catch{throw new Error('INVALID_TIMELINE_CURSOR')}}
 const rows=await db.$queryRaw<{id:string;kind:string;recordedAt:string;evidence:Record<string,unknown>}[]>`
 WITH history AS (
 SELECT p."id"::text AS id,'JOURNAL'::text AS kind,p."recordedAt" AS at,p."evidence" FROM "PortfolioJournal" p WHERE p."ownerId"=${ownerId}::uuid AND (p."evidence"->>'isin'=${isin} OR EXISTS (SELECT 1 FROM "PortfolioJournal" f WHERE f."ownerId"=${ownerId}::uuid AND f."id"::text=p."evidence"->>'targetId' AND f."evidence"->>'isin'=${isin}) OR EXISTS (SELECT 1 FROM "PortfolioCashAllocation" a JOIN "InitialPositionStop" s ON s."episodeId"=a."episodeId" AND s."ownerId"=a."ownerId" WHERE a."ownerId"=${ownerId}::uuid AND a."cashEventId"=p."id" AND s."isin"=${isin}))
 UNION ALL SELECT s."id",'INITIAL_STOP',(s."evidence"->>'recordedAt')::timestamptz,s."evidence" FROM "InitialPositionStop" s WHERE s."ownerId"=${ownerId}::uuid AND s."isin"=${isin}
 UNION ALL SELECT t."id",'TRAIL',t."decidedAt",t."evidence" FROM "PositionTrail" t JOIN "InitialPositionStop" s ON s."id"=t."stopId" WHERE t."ownerId"=${ownerId}::uuid AND s."ownerId"=${ownerId}::uuid AND s."isin"=${isin}
 UNION ALL SELECT t."id",'PROTECTIVE',t."recognizedAt",t."evidence" FROM "ProtectiveSignal" t JOIN "InitialPositionStop" s ON s."id"=t."stopId" WHERE t."ownerId"=${ownerId}::uuid AND s."ownerId"=${ownerId}::uuid AND s."isin"=${isin}
 UNION ALL SELECT t."id",'BREAKOUT_FAILURE',t."recognizedAt",t."evidence" FROM "PositionFailure" t JOIN "InitialPositionStop" s ON s."id"=t."stopId" WHERE t."ownerId"=${ownerId}::uuid AND s."ownerId"=${ownerId}::uuid AND s."isin"=${isin}
 UNION ALL SELECT t."id",'PARTIAL_PROFIT',t."recognizedAt",t."evidence" FROM "PartialProfitSignal" t JOIN "InitialPositionStop" s ON s."id"=t."stopId" WHERE t."ownerId"=${ownerId}::uuid AND s."ownerId"=${ownerId}::uuid AND s."isin"=${isin}
 UNION ALL SELECT r."id",'PARTIAL_RESOLUTION',r."recordedAt",r."evidence" FROM "PartialProfitResolution" r JOIN "PartialProfitSignal" p ON p."id"=r."signalId" JOIN "InitialPositionStop" s ON s."id"=p."stopId" WHERE p."ownerId"=${ownerId}::uuid AND s."ownerId"=${ownerId}::uuid AND s."isin"=${isin}
 UNION ALL SELECT t."id",'EXIT_RESOLUTION',t."recordedAt",t."evidence" FROM "ExitResolution" t WHERE t."ownerId"=${ownerId}::uuid AND t."evidence"->>'isin'=${isin}
 UNION ALL SELECT t."id",'STATUS',t."recordedAt",t."evidence" FROM "PositionStatusHistory" t JOIN "InitialPositionStop" s ON s."id"=t."stopId" WHERE t."ownerId"=${ownerId}::uuid AND s."ownerId"=${ownerId}::uuid AND s."isin"=${isin}
 UNION ALL SELECT t."id",'MONITOR',t."eventAt",t."evidence" FROM "PositionMonitorEvent" t WHERE t."ownerId"=${ownerId}::uuid AND t."isin"=${isin}
 UNION ALL SELECT t."id",'ACKNOWLEDGEMENT',t."recordedAt",t."evidence" FROM "PositionAlertAcknowledgement" t WHERE t."ownerId"=${ownerId}::uuid AND t."isin"=${isin}
 UNION ALL SELECT a."id",'CASH_ALLOCATION',(a."evidence"->>'recordedAt')::timestamptz,a."evidence" FROM "PortfolioCashAllocation" a JOIN "InitialPositionStop" s ON s."episodeId"=a."episodeId" AND s."ownerId"=a."ownerId" WHERE a."ownerId"=${ownerId}::uuid AND s."isin"=${isin}
 ) SELECT id,kind,to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "recordedAt","evidence" FROM history WHERE at<=${cutoff}::timestamptz AND (at,kind,id)<(${before}::timestamptz,${kind},${id}) ORDER BY at DESC,kind DESC,id DESC LIMIT 51`;
 const items=rows.slice(0,50),last=items.at(-1);
 return {isin,asOf:cutoff,items,nextCursor:rows.length>50&&last?Buffer.from(JSON.stringify({isin,cutoff,before:last.recordedAt,kind:last.kind,id:last.id})).toString('base64url'):null,executable:false};
}
