import {readFile} from 'node:fs/promises';
import {PrismaClient,bindBackfill,type BackfillBinding} from '@vcp/database';
import {prepareIncremental,type IncrementalInput} from './incremental.js';
const db=new PrismaClient();
try{
 const path=process.argv[2];if(!path)throw new Error();
 const input=JSON.parse(await readFile(path,'utf8')) as {preparation:IncrementalInput;binding:Omit<BackfillBinding,'runId'>};
 const result=await prepareIncremental(db,input.preparation);
 if(result.state==='UNKNOWN')throw new Error();
 if(result.state!=='IDLE')await bindBackfill(db,{...input.binding,runId:input.preparation.id});
 process.stdout.write(JSON.stringify({runId:result.state==='IDLE'?null:input.preparation.id,state:result.state})+'\n');
}catch{process.stderr.write('INCREMENTAL_SUBMISSION_FAILED\n');process.exitCode=1}finally{await db.$disconnect()}
