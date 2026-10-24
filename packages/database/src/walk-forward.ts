import type {PrismaClient} from '@prisma/client';
import {compareWalkForward,type WalkForwardFold,type WalkForwardRun} from '@vcp/backtest';
import {configurationHash} from '@vcp/strategy';
import {readPaperPerformance} from './paper-performance.js';
import type {StoredHistoricalSnapshot} from './backtest-snapshots.js';
export interface StoredWalkForwardFold {id:string;candidates:readonly {id:string;train:{runId:string;asOf:string};validation:{runId:string;asOf:string};outOfSample:{runId:string;asOf:string}}[]}
/** Resolve all metrics from owner-scoped stored runs; the request cannot supply performance numbers. */
export async function compareStoredWalkForward(db:PrismaClient,ownerId:string,plan:readonly StoredWalkForwardFold[]){
 if(!plan.length||plan.length>50||plan.some(fold=>!Array.isArray(fold.candidates)||!fold.candidates.length||fold.candidates.length>20))throw new Error('INVALID_WALK_FORWARD_PLAN');
 const cache=new Map<string,WalkForwardRun>(),folds:WalkForwardFold[]=[];
 const load=async(reference:{runId:string;asOf:string})=>{
  const key=configurationHash(reference),prior=cache.get(key);if(prior)return prior;
  const rows=await db.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT s."evidence" FROM "HistoricalReplayRun" r JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" WHERE r."id"=${reference.runId} AND r."ownerId"=${ownerId}::uuid`;
  const snapshot=rows[0]?.evidence.snapshot;if(!snapshot)throw new Error('REPLAY_RUN_NOT_FOUND');
  const report=await readPaperPerformance(db,ownerId,reference.runId,reference.asOf);
  const result={runId:reference.runId,window:{from:snapshot.inputs.from,through:snapshot.inputs.through},strategyRevision:configurationHash({configuration:snapshot.strategyHash,code:snapshot.inputs.strategySha}),dataRevision:snapshot.dataRevision,report};
  cache.set(key,result);return result;
 };
 for(const fold of plan){
  const candidates=[];
  for(const candidate of fold.candidates)candidates.push({id:candidate.id,train:await load(candidate.train),validation:await load(candidate.validation),outOfSample:await load(candidate.outOfSample)});
  folds.push({id:fold.id,candidates});
 }
 return compareWalkForward(folds);
}
