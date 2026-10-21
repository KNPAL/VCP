import type {Prisma} from '@prisma/client';
import type {ProtectiveStop} from '@vcp/portfolio';
import type {InitialStop} from './protective-stops.js';
export async function effectivePositionStop(tx:Prisma.TransactionClient,record:InitialStop,asOf:string):Promise<ProtectiveStop|null>{
 if(!record.stop)return null;
 const rows=await tx.$queryRaw<{evidence:{result:{nextStop:string;effectiveAt:string}}}[]>`SELECT "evidence" FROM "PositionTrail" WHERE "stopId"=${record.id} AND "effectiveAt"<=${new Date(asOf)} AND "state" IN ('TRAIL_UPDATE','TRAIL_UNCHANGED','SELL_EMA_CLOSE') ORDER BY "session" DESC,"decidedAt" DESC,"id" LIMIT 1`;
 const latest=rows[0]?.evidence.result;
 return latest?{...record.stop,activeStop:latest.nextStop,effectiveAt:latest.effectiveAt}:record.stop;
}
