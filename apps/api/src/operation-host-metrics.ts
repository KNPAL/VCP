import {readFile,statfs} from 'node:fs/promises';

export async function operationHostMetrics(env:NodeJS.ProcessEnv,now=Date.now()){
 const volume=env['VCP_MONITORED_VOLUME'],receipt=env['VCP_BACKUP_STATUS_FILE'];
 let disk:null|{freePercent:number;warningBelowPercent:number;state:string}=null;
 if(volume){
  const warning=Number(env['VCP_DISK_WARNING_PERCENT']??10);
  try{
   const stats=await statfs(volume);
   if(stats.blocks>0&&warning>0&&warning<=100){
    const freePercent=100*stats.bavail/stats.blocks;
    disk={freePercent,warningBelowPercent:warning,state:freePercent<warning?'WARNING':'OK'};
   }
  }catch{/* Missing or unreadable monitored volume has unknown capacity. */}
 }
 let backup:null|{completedAt:string;state:string}=null;
 if(receipt){
  try{
   const record=JSON.parse(await readFile(receipt,'utf8')),timestamp=Date.parse(record.completedAt);
   if(typeof record.completedAt==='string'&&Number.isFinite(timestamp)&&timestamp<=now&&['SUCCESS','FAILED'].includes(record.state)){
    backup={completedAt:new Date(timestamp).toISOString(),state:record.state};
   }
  }catch{/* A missing or invalid backup receipt cannot establish success. */}
 }
 return {disk,backup};
}
