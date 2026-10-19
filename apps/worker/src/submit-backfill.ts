import {readFile} from 'node:fs/promises';
import {PrismaClient,bindBackfill,type BackfillBinding} from '@vcp/database';
import {prepareBackfill} from './backfill.js';
const db=new PrismaClient();
try{
 const path=process.argv[2];if(!path)throw new Error();
 const input=JSON.parse(await readFile(path,'utf8')) as {preparation:Parameters<typeof prepareBackfill>[1];binding:Omit<BackfillBinding,'runId'>};
 const result=await prepareBackfill(db,input.preparation);if(result.state==='UNKNOWN')throw new Error();
 await bindBackfill(db,{...input.binding,runId:input.preparation.id});
 process.stdout.write(JSON.stringify({runId:input.preparation.id,state:result.state})+'\n');
}catch{process.stderr.write('BACKFILL_SUBMISSION_FAILED\n');process.exitCode=1}finally{await db.$disconnect()}
