import {readFile} from 'node:fs/promises';
import {queue,enqueueOnce} from './runtime.js';
const q=queue();
try{
 const path=process.argv[2];if(!path)throw new Error();
 const input=JSON.parse(await readFile(path,'utf8')) as Record<string,unknown>;
 if(Object.keys(input).length!==3||typeof input['eventId']!=='string'||typeof input['adjustmentId']!=='string'||typeof input['calendarHash']!=='string')throw new Error();
 const job=await enqueueOnce(q,'indicator-replay',[input['eventId'],input['adjustmentId'],input['calendarHash']].join('|'),input);
 process.stdout.write(JSON.stringify({jobId:job.id})+'\n');
}catch{process.stderr.write('REPLAY_SUBMISSION_FAILED\n');process.exitCode=1}finally{await q.close()}
