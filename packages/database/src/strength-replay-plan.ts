import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {canonical} from './indicators.js';
import {persistRelativeStrengthReplay,type StrengthReplayInput} from './rs-replay.js';

/** Reuse explicit context only for the same historical interval and listing.
 * All peer/benchmark revisions stay pinned; only the corrected target changes.
 * Automatically produced context cannot become its own recursive template. */
export async function prepareStrengthReplayPlans(db:PrismaClient){
 const candidates=await db.$queryRaw<{receiptId:string;listingId:string;adjustmentId:string;templateId:string;input:StrengthReplayInput}[]>`
 SELECT i."id" AS "receiptId",i."evidence"->>'listingId' AS "listingId",i."adjustmentId",t."id" AS "templateId",t."evidence"->'input' AS "input"
 FROM "IndicatorReplayReceipt" i
 JOIN LATERAL (
  SELECT r.* FROM "RelativeStrengthReplay" r JOIN "IndicatorReplayReceipt" original ON original."id"=r."indicatorReceiptId"
  WHERE r."evidence"->>'listingId'=i."evidence"->>'listingId'
   AND original."evidence"->>'from'=i."evidence"->>'from' AND original."evidence"->>'to'=i."evidence"->>'to'
   AND r."evidence"->>'state'='COMPUTED'
   AND NOT EXISTS (SELECT 1 FROM "StrengthReplayPlan" auto WHERE auto."id"=r."id")
  ORDER BY r."createdAt" DESC,r."id" DESC LIMIT 1
 ) t ON true
 WHERE NOT EXISTS (SELECT 1 FROM "RelativeStrengthReplay" done WHERE done."indicatorReceiptId"=i."id")
 AND NOT EXISTS (SELECT 1 FROM "StrengthReplayPlan" p WHERE p."indicatorReceiptId"=i."id" AND p."templateId"=t."id")
 ORDER BY i."createdAt",i."id" LIMIT 25`;
 for(const row of candidates){
  const input:StrengthReplayInput={...row.input,indicatorReceiptId:row.receiptId,memberAdjustmentIds:{...row.input.memberAdjustmentIds,[row.listingId]:row.adjustmentId},evaluatedAt:new Date().toISOString()};
  const id=createHash('sha256').update(canonical(input)).digest('hex');
  await db.$executeRaw`INSERT INTO "StrengthReplayPlan" ("id","indicatorReceiptId","templateId","evidence") VALUES (${id},${row.receiptId},${row.templateId},${canonical(input)}::jsonb) ON CONFLICT DO NOTHING`;
 }
 return {prepared:candidates.length};
}
export async function pendingStrengthReplayPlans(db:PrismaClient){
 return db.$queryRaw<{id:string}[]>`SELECT p."id" FROM "StrengthReplayPlan" p LEFT JOIN "StrengthReplayDispatch" d ON d."planId"=p."id" WHERE NOT EXISTS (SELECT 1 FROM "RelativeStrengthReplay" r WHERE r."id"=p."id") ORDER BY COALESCE(d."checkedAt",p."createdAt"),p."id" LIMIT 25`;
}
export async function executeStrengthReplayPlan(db:PrismaClient,id:string){
 if(!/^[0-9a-f]{64}$/.test(id))throw new Error('INVALID_STRENGTH_PLAN');
 const rows=await db.$queryRaw<{evidence:StrengthReplayInput}[]>`SELECT "evidence" FROM "StrengthReplayPlan" WHERE "id"=${id}`;
 if(!rows[0])throw new Error('STRENGTH_PLAN_UNAVAILABLE');
 return persistRelativeStrengthReplay(db,rows[0].evidence);
}
export async function recordStrengthReplayDispatch(db:PrismaClient,id:string,state:string){
 await db.$executeRaw`INSERT INTO "StrengthReplayDispatch" ("planId","state") VALUES (${id},${state}) ON CONFLICT ("planId") DO UPDATE SET "state"=EXCLUDED."state","checkedAt"=CURRENT_TIMESTAMP`;
}
