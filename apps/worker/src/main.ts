import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker,queue} from './runtime.js';
const q=queue();
const worker=createWorker('vcp',{health:async()=>({status:'UP'})});
worker.on('error',()=>console.error(JSON.stringify({code:'WORKER_ERROR'})));
const heartbeat=setInterval(()=>{void (async()=>{const client=await q.client;await client.info();await writeFile(join(tmpdir(),'vcp-worker-health'),new Date().toISOString());})().catch(()=>console.error(JSON.stringify({code:'REDIS_UNAVAILABLE'})));},5000);
async function stop(){clearInterval(heartbeat);await worker.close();await q.close()}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());

