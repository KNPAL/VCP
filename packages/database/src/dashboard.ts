import type {PrismaClient} from '@prisma/client';
import {latestScan} from './scans.js';
import {readPortfolioRisk} from './portfolio-risk.js';
import {readPositionStatus} from './position-status.js';
import {getReadiness} from './readiness.js';
import {eodScanProgress} from './eod-scan.js';

/** Read-only composition. Each authority retains its own evidence and observation time. */
export async function readDashboard(db:PrismaClient,ownerId:string){
 const [scan,risk,statuses,readiness,plans]=await Promise.all([
  latestScan(db),readPortfolioRisk(db,ownerId),readPositionStatus(db,ownerId),getReadiness(db),
  db.$queryRaw<{id:string}[]>`SELECT "id" FROM "EodScanPlan" WHERE "createdAt"<=clock_timestamp() AND "evidence"->'request'->>'asOf'<=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ORDER BY "evidence"->'request'->>'asOf' DESC,"createdAt" DESC,"id" LIMIT 1`
 ]);
 const progress=plans[0]?await eodScanProgress(db,plans[0].id):null;
 const asOf=new Date().toISOString();
 const usable=scan&&Date.parse(scan.asOf)<=Date.parse(asOf)?scan:null;
 const signals=usable?Object.fromEntries(['WATCH','READY','BUY_MARKET_SIGNAL'].map(state=>[state,usable.candidates.filter(c=>c.marketState===state).length])):null;
 return {asOf,executable:false,
  scan:usable?{scanId:usable.scanId,asOf:usable.asOf,status:usable.status,counts:usable.counts,dataRevision:usable.dataRevision,configHash:usable.configHash,signals}:null,
  scanReason:usable?null:scan?'SCAN_FROM_FUTURE':'NO_COMPLETED_SCAN',
  progress:progress?{scanId:progress.scanId,asOf:progress.request.asOf,intended:progress.intended,processed:progress.completed,finished:progress.result!==null}:null,
  risk,statuses,readiness};
}
