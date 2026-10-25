import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {canonical} from './indicators.js';
type Acknowledgement={id:string;signalId:string;isin:string;kind:string;note:string;recordedAt:string;executable:false;executionRecorded:false};
/** A review acknowledgement never resolves the exit, changes quantities, or asserts an execution. */
export async function acknowledgePositionAlert(db:PrismaClient,ownerId:string,signalId:string,note:string){
 if(!/^[a-f0-9]{64}$/.test(signalId)||!note.trim()||note.length>1000)throw new Error('INVALID_ALERT_ACKNOWLEDGEMENT');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const prior=await tx.$queryRaw<{evidence:Acknowledgement}[]>`SELECT "evidence" FROM "PositionAlertAcknowledgement" WHERE "ownerId"=${ownerId}::uuid AND "signalId"=${signalId}`;
  if(prior[0]){if(prior[0].evidence.note!==note)throw new Error('STALE_CONFLICT');return prior[0].evidence}
  const sources=await tx.$queryRaw<{isin:string;kind:string}[]>`
   SELECT s."isin",'SELL_PROTECTIVE' AS kind FROM "ProtectiveSignal" p JOIN "InitialPositionStop" s ON s."id"=p."stopId" WHERE p."id"=${signalId} AND p."ownerId"=${ownerId}::uuid AND s."ownerId"=${ownerId}::uuid AND p."recognizedAt"<=clock_timestamp()
   UNION ALL SELECT s."isin",'SELL_BREAKOUT_FAILURE' FROM "PositionFailure" p JOIN "InitialPositionStop" s ON s."id"=p."stopId" WHERE p."id"=${signalId} AND p."ownerId"=${ownerId}::uuid AND s."ownerId"=${ownerId}::uuid AND p."recognizedAt"<=clock_timestamp() AND p."state"='SELL_BREAKOUT_FAILURE'
   UNION ALL SELECT s."isin",'SELL_EMA_CLOSE' FROM "PositionTrail" p JOIN "InitialPositionStop" s ON s."id"=p."stopId" WHERE p."id"=${signalId} AND p."ownerId"=${ownerId}::uuid AND s."ownerId"=${ownerId}::uuid AND p."decidedAt"<=clock_timestamp() AND p."state"='SELL_EMA_CLOSE'
   UNION ALL SELECT s."isin",'PARTIAL_PROFIT' FROM "PartialProfitSignal" p JOIN "InitialPositionStop" s ON s."id"=p."stopId" WHERE p."id"=${signalId} AND p."ownerId"=${ownerId}::uuid AND s."ownerId"=${ownerId}::uuid AND p."recognizedAt"<=clock_timestamp()`;
  if(sources.length!==1)throw new Error('POSITION_ALERT_NOT_FOUND');
  const id=createHash('sha256').update(canonical([ownerId,signalId])).digest('hex'),evidence:Acknowledgement={id,signalId,isin:sources[0]!.isin,kind:sources[0]!.kind,note,recordedAt:new Date().toISOString(),executable:false,executionRecorded:false};
  await tx.$executeRaw`INSERT INTO "PositionAlertAcknowledgement" ("id","ownerId","signalId","isin","recordedAt","evidence") VALUES (${id},${ownerId}::uuid,${signalId},${evidence.isin},${new Date(evidence.recordedAt)},${canonical(evidence)}::jsonb)`;
  return evidence;
 });
}
