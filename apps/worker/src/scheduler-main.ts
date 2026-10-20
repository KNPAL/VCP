import {randomUUID} from 'node:crypto';
import {PrismaClient,releaseSchedulerLease,claimSchedulerLease} from '@vcp/database';
import {trace} from '@vcp/domain/logging';
import {queue} from './runtime.js';
import {runSchedulerCycle} from './scheduler.js';
const db=new PrismaClient(),q=queue(),ownerId=randomUUID();let running:Promise<unknown>|null=null;
const tick=()=>{if(!running)running=trace('worker.poll',()=>runSchedulerCycle(db,q,ownerId)).catch(()=>{}).finally(()=>{running=null})};
const timer=setInterval(tick,5000);tick();
async function stop(){clearInterval(timer);await running;const lease=await claimSchedulerLease(db,ownerId);if(lease)await releaseSchedulerLease(db,lease);await q.close();await db.$disconnect()}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
