import type {PrismaClient} from '@prisma/client';
import {historicalProbe,type HistoricalProbeInput} from '@vcp/market-data';
/** Internal gateway evidence; no credentials, response bodies or raw broker errors are stored. */
export async function recordHistoricalProbe(db:PrismaClient,accountKey:string,id:string,input:HistoricalProbeInput){
 if(!/^[0-9a-f]{64}$/.test(accountKey))throw new Error('INVALID_BROKER_ACCOUNT_KEY');
 const report=historicalProbe(input);
 await db.$transaction(async tx=>{
  await tx.$executeRaw`INSERT INTO "HistoricalProbe" ("id","accountKey","revision","asOf","evidence") VALUES (${id}::uuid,${accountKey},${report.revision},${new Date(report.asOf)},${JSON.stringify(report)}::jsonb) ON CONFLICT DO NOTHING`;
  const existing=await tx.$queryRaw<{revision:string;accountKey:string}[]>`SELECT "revision","accountKey" FROM "HistoricalProbe" WHERE "id"=${id}::uuid`;
  if(existing[0]?.revision!==report.revision||existing[0]?.accountKey!==accountKey)throw new Error('HISTORICAL_PROBE_ID_CONFLICT');
 });
 return report;
}
