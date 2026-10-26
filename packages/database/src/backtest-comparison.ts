import type {PrismaClient} from '@prisma/client';
import {configurationHash} from '@vcp/strategy';
import {parseFixed} from '@vcp/domain';
import type {StoredHistoricalSnapshot} from './backtest-snapshots.js';
import {compareStoredWalkForward} from './walk-forward.js';
export interface BacktestComparisonSelection {train:string;validation:string;test:string}
/** Resolve cutoffs and assumptions from owner archives; browsers cannot supply metrics or future dates. */
export async function compareBacktestSelection(db:PrismaClient,ownerId:string,input:BacktestComparisonSelection){
 const phases=['train','validation','test'] as const;
 if(!input||typeof input!=='object'||Object.keys(input).length!==3||phases.some(p=>typeof input[p]!=='string'||!/^[a-f0-9]{64}$/.test(input[p]))||new Set(phases.map(p=>input[p])).size!==3)throw new Error('INVALID_BACKTEST_SELECTION');
 const loaded:{phase:typeof phases[number];runId:string;asOf:string;from:string;through:string;strategy:string;costs:string;snapshotId:string;dataRevision:string;universeRevision:string;calendarRevision:string}[]=[];
 for(const phase of phases){
  const rows=await db.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT s."evidence" FROM "HistoricalReplayRun" r JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" AND s."ownerId"=r."ownerId" WHERE r."id"=${input[phase]} AND r."ownerId"=${ownerId}::uuid`;
  const stored=rows[0]?.evidence;if(!stored)throw new Error('REPLAY_RUN_NOT_FOUND');const s=stored.snapshot,p=s.inputs;
  if(parseFixed(p.fees.slippageBps)!==10000000n||!p.fees.sourceReference.trim())throw new Error('BACKTEST_STANDARD_COSTS_REQUIRED');
  loaded.push({phase,runId:input[phase],asOf:new Date(Math.min(Date.parse(p.knownAt),Date.parse(p.through+'T18:29:59.999Z'))).toISOString(),from:p.from,through:p.through,strategy:configurationHash({configuration:s.strategyHash,code:p.strategySha}),costs:configurationHash(p.fees),snapshotId:stored.id,dataRevision:s.dataRevision,universeRevision:configurationHash(p.universes),calendarRevision:configurationHash(p.calendar)});
 }
 if(loaded.some(row=>row.strategy!==loaded[0]!.strategy||row.costs!==loaded[0]!.costs))throw new Error('BACKTEST_CONFIGURATION_MISMATCH');
 if(loaded[0]!.through>=loaded[1]!.from||loaded[1]!.through>=loaded[2]!.from)throw new Error('WALK_FORWARD_WINDOW_OVERLAP');
 const [train,validation,outOfSample]=loaded;
 const result=await compareStoredWalkForward(db,ownerId,[{id:'selected-windows',candidates:[{id:loaded[0]!.strategy,train:train!,validation:validation!,outOfSample:outOfSample!}]}]);
 return {...result,selection:loaded,standardSlippageBps:'10'};
}
