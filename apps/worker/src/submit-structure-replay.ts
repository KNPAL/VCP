import {readFile} from 'node:fs/promises';
import {queue,enqueueOnce} from './runtime.js';
const q=queue();
try{
 const path=process.argv[2];if(!path)throw new Error();
 const input=JSON.parse(await readFile(path,'utf8')) as Record<string,unknown>;
 if(Object.keys(input).length!==3||![input['indicatorReceiptId'],input['instrumentSnapshotId'],input['profileId']].every(v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v)))throw new Error();
 const job=await enqueueOnce(q,'structure-replay',[input['indicatorReceiptId'],input['instrumentSnapshotId'],input['profileId']].join('|'),input);
 process.stdout.write(JSON.stringify({jobId:job.id})+'\n');
}catch{process.stderr.write('STRUCTURE_REPLAY_SUBMISSION_FAILED\n');process.exitCode=1}finally{await q.close()}
