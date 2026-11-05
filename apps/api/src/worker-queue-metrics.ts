import {Queue} from 'bullmq';
export async function workerQueueMetrics(env:NodeJS.ProcessEnv){
 const queue=new Queue('vcp',{skipMetasUpdate:true,connection:{host:env['REDIS_HOST']??'127.0.0.1',port:Number(env['REDIS_PORT']??6379),retryStrategy:()=>null,maxRetriesPerRequest:1,connectTimeout:1000,commandTimeout:1500}});
 queue.on('error',()=>{/* Availability is reported as unknown. */});
 try{
  const [counts,waiting]=await Promise.all([queue.getJobCounts('waiting','active','failed'),queue.getWaiting(0,0)]);
  const oldest=waiting[0]?.timestamp;
  return {waiting:counts['waiting']??0,active:counts['active']??0,failed:counts['failed']??0,oldestSeconds:oldest===undefined?null:Math.max(0,Math.floor((Date.now()-oldest)/1000))};
 }catch{return null}
 finally{await queue.disconnect().catch(()=>{})}
}
