import {readFile} from 'node:fs/promises';
import {PrismaClient,persistRelativeStrengthReplay,type StrengthReplayInput} from '@vcp/database';
const db=new PrismaClient();
try{
 const path=process.argv[2];if(!path)throw new Error();
 const input=JSON.parse(await readFile(path,'utf8')) as StrengthReplayInput;
 const result=await persistRelativeStrengthReplay(db,input);
 process.stdout.write(JSON.stringify({id:result.id,state:result.state,sessions:result.rows.length})+'\n');
}catch{process.stderr.write('RS_REPLAY_PREPARATION_FAILED\n');process.exitCode=1}finally{await db.$disconnect()}
