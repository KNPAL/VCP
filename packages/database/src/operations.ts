import type {PrismaClient} from '@prisma/client';
import {getReadiness} from './readiness.js';
import {ownerBrokerBinding} from './broker-configuration.js';

export async function readOperations(db:PrismaClient,ownerId:string,legacyAccount?:string){
 const at=new Date(),asOf=at.toISOString();
 const {accountKey}=await ownerBrokerBinding(db,ownerId,legacyAccount);
 const [gates,attempts,queue,monitors,delivery,candle,scan,adjustment]=await Promise.all([
  getReadiness(db,asOf),
  db.$queryRaw<{hour:Date;requests:number;errors:number;forbidden:number;limited:number}[]>`
   SELECT date_trunc('hour',"at") AS hour,count(*)::int AS requests,
    count(*) FILTER(WHERE "httpStatus">=400 OR reason IS NOT NULL)::int AS errors,
    count(*) FILTER(WHERE "httpStatus"=403)::int AS forbidden,count(*) FILTER(WHERE "httpStatus"=429)::int AS limited
   FROM "BrokerRequestAttempt" WHERE "accountKey"=${accountKey??null} AND "at" BETWEEN ${new Date(+at-86400000)} AND ${at} GROUP BY 1 ORDER BY 1 DESC`,
  db.$queryRaw<{due:number;oldest:Date|null;failed:number}[]>`
   SELECT count(*) FILTER(WHERE state IN ('PENDING','PARTIAL') AND "nextAttemptAt"<=${at})::int AS due,
    min("nextAttemptAt") FILTER(WHERE state IN ('PENDING','PARTIAL') AND "nextAttemptAt"<=${at}) AS oldest,
    count(*) FILTER(WHERE state='FAILED')::int AS failed FROM "HistoricalSyncWindow"`,
  db.$queryRaw<{stale:number;held:number;latest:Date|null}[]>`
   SELECT count(*) FILTER (WHERE evidence->>'state'<>'FEED_FRESH' OR "asOf"<${new Date(+at-15000)} OR coalesce((evidence->>'validUntil')::timestamptz,'-infinity')<=${at})::int AS stale,
    count(*)::int AS held,max((evidence->>'sourceAt')::timestamptz) AS latest
   FROM "PositionMonitor" WHERE "ownerId"=${ownerId}::uuid AND "asOf"<=${at} AND evidence->>'state'<>'CLOSED'`,
  db.$queryRaw<{pending:number}[]>`SELECT count(*)::int AS pending FROM "NotificationOutbox" o JOIN "AlertEvent" e ON e.id=o."eventId"
   LEFT JOIN "NotificationDelivery" d ON d."outboxId"=o.id
   WHERE o."ownerId"=${ownerId}::uuid AND e.evidence->>'kind'='SELL' AND d.state IS DISTINCT FROM 'DELIVERED'`,
  db.rawDailyCandle.findFirst({where:{finalizedAt:{lte:at},receivedAt:{lte:at}},orderBy:{session:'desc'},select:{session:true}}),
  db.$queryRaw<{asOf:Date;createdAt:Date;status:string;counts:Record<string,number>}[]>`SELECT "asOf","createdAt",status,evidence->'counts' AS counts FROM "ScanResult" WHERE "asOf"<=${at} AND "createdAt"<=${at} ORDER BY "asOf" DESC,"createdAt" DESC LIMIT 1`,
  db.adjustmentSnapshot.findFirst({where:{asOf:{lte:at},createdAt:{lte:at}},orderBy:[{createdAt:'desc'},{id:'asc'}],select:{id:true,state:true,asOf:true}})
 ]);
 const lastScan=scan[0],feedAt=monitors[0]?.latest;
 return {asOf,readiness:gates.items.every(g=>g.status==='PASS')?'PASS':'BLOCKED',gates:gates.items.map(g=>({gate:g.gate,status:g.status})),
  brokerConfigured:!!accountKey,attempts,queue:queue[0],monitor:monitors[0],feedAgeSeconds:feedAt?Math.floor((+at-+feedAt)/1000):null,
  pendingSell:delivery[0]?.pending??null,finalizedSession:candle?.session.toISOString().slice(0,10)??null,
  scan:lastScan?{...lastScan,publicationLagSeconds:(+lastScan.createdAt-+lastScan.asOf)/1000}:null,adjustment};
}
