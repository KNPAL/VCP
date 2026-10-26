import {prepareManualDownload} from '@vcp/database';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker,queue} from './runtime.js';
import {PrismaClient,deliverAlert} from '@vcp/database';
import {candleChangeHandler,dispatchCandleChanges} from './correction-delivery.js';
import {backfillHandler,dispatchBackfills} from './backfill-delivery.js';
import {directoryBrokerKeys} from './broker-auth.js';
import {trace,writeLog} from '@vcp/domain/logging';
import {indicatorReplayHandler,dispatchIndicatorReplays} from './indicator-replay.js';
import {structureReplayHandler,dispatchStructureReplays} from './structure-replay.js';
import {strengthReplayHandler,dispatchStrengthReplays} from './strength-replay.js';
import {eodScanHandler,dispatchEodScans} from './eod-scan.js';
import {scheduledScanHandler,dispatchScheduledScans,runSchedulerCycle} from './scheduler.js';
import {monitorHeldPositions} from './position-monitor.js';
import {StreamOwner} from './stream-owner.js';
import {streamDependencies} from './stream-context.js';
const db=new PrismaClient();
const q=queue();
const loadKey=async(keyId:string)=>{const directory=process.env['BROKER_KEY_DIRECTORY'];if(!directory)throw new Error('BROKER_UNAVAILABLE');return directoryBrokerKeys(directory)(keyId)};
const streamAccount=process.env['VCP_STREAM_ACCOUNT_KEY'];
if(process.env['VCP_ENABLE_LIVE_STREAM']==='true'&&!streamAccount)throw new Error('STREAM_ACCOUNT_REQUIRED');
const streamName=streamAccount?'smartapi-'+streamAccount:process.env['VCP_STREAM_OWNER'];
const stream=process.env['VCP_ENABLE_LIVE_STREAM']==='true'&&streamAccount?new StreamOwner(q,streamName!,'ANGEL_ONE',Number(process.env['VCP_STREAM_CAPACITY']??100),streamDependencies(db,streamAccount,loadKey)):null;
const streamTimer=stream?setInterval(()=>void stream.cycle(),3000):null;
const worker=createWorker('vcp',{health:async()=>({status:'UP'}),'candle-change':candleChangeHandler(db),backfill:backfillHandler(db,q,loadKey),'indicator-replay':indicatorReplayHandler(db),'strength-replay':strengthReplayHandler(db),'structure-replay':structureReplayHandler(db),'eod-scan':eodScanHandler(db),'eod-prepare':scheduledScanHandler(db)});
const schedulerOwner=randomUUID();
worker.on('error',()=>{const at=new Date().toISOString();writeLog('worker.error',{startedAt:at,finishedAt:at,result:'FAILED',failureCode:'WORKER_ERROR'})});
let polling:Promise<void>|null=null;
const heartbeat=setInterval(()=>{if(polling)return;polling=trace('worker.poll',async()=>{await monitorHeldPositions(db,q,streamName);for(let i=0;i<25;i++){if((await deliverAlert(db)).state==='IDLE')break}const client=await q.client;await client.info();if(process.env['VCP_ENABLE_EOD_SCHEDULER']==='true')await runSchedulerCycle(db,q,schedulerOwner);await dispatchScheduledScans(db,q);await dispatchCandleChanges(db,q);if(process.env['VCP_ENABLE_MANUAL_DOWNLOADS']==='true')await prepareManualDownload(db);await dispatchBackfills(db,q);await dispatchIndicatorReplays(db,q);await dispatchStrengthReplays(db,q);await dispatchStructureReplays(db,q);await dispatchEodScans(db,q);await writeFile(join(tmpdir(),'vcp-worker-health'),new Date().toISOString());}).catch(()=>{}).finally(()=>{polling=null});},5000);
async function stop(){clearInterval(heartbeat);if(streamTimer)clearInterval(streamTimer);await stream?.stop();await polling;await worker.close();await q.close();await db.$disconnect()}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());



