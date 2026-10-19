import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker,queue} from './runtime.js';
import {PrismaClient} from '@vcp/database';
import {candleChangeHandler,dispatchCandleChanges} from './correction-delivery.js';
import {backfillHandler,dispatchBackfills} from './backfill-delivery.js';
import {directoryBrokerKeys} from './broker-auth.js';
import {trace,writeLog} from '@vcp/domain/logging';
import {indicatorReplayHandler,dispatchIndicatorReplays} from './indicator-replay.js';
import {structureReplayHandler,dispatchStructureReplays} from './structure-replay.js';
import {strengthReplayHandler,dispatchStrengthReplays} from './strength-replay.js';
const db=new PrismaClient();
const q=queue();
const loadKey=async(keyId:string)=>{const directory=process.env['BROKER_KEY_DIRECTORY'];if(!directory)throw new Error('BROKER_UNAVAILABLE');return directoryBrokerKeys(directory)(keyId)};
const worker=createWorker('vcp',{health:async()=>({status:'UP'}),'candle-change':candleChangeHandler(db),backfill:backfillHandler(db,q,loadKey),'indicator-replay':indicatorReplayHandler(db),'strength-replay':strengthReplayHandler(db),'structure-replay':structureReplayHandler(db)});
worker.on('error',()=>{const at=new Date().toISOString();writeLog('worker.error',{startedAt:at,finishedAt:at,result:'FAILED',failureCode:'WORKER_ERROR'})});
let polling:Promise<void>|null=null;
const heartbeat=setInterval(()=>{if(polling)return;polling=trace('worker.poll',async()=>{const client=await q.client;await client.info();await dispatchCandleChanges(db,q);await dispatchBackfills(db,q);await dispatchIndicatorReplays(db,q);await dispatchStrengthReplays(db,q);await dispatchStructureReplays(db,q);await writeFile(join(tmpdir(),'vcp-worker-health'),new Date().toISOString());}).catch(()=>{}).finally(()=>{polling=null});},5000);
async function stop(){clearInterval(heartbeat);await polling;await worker.close();await q.close();await db.$disconnect()}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());

