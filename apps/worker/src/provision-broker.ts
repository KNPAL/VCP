import {readFile} from 'node:fs/promises';
import {PrismaClient} from '@vcp/database';
import {queue} from './runtime.js';
import {provisionBrokerSession,directoryBrokerKeys} from './broker-auth.js';
const db=new PrismaClient(),q=queue();
try{
 const path=process.argv[2],directory=process.env['BROKER_KEY_DIRECTORY'];if(!path||!directory)throw new Error();
 const input=JSON.parse(await readFile(path,'utf8')) as Parameters<typeof provisionBrokerSession>[2];
 const result=await provisionBrokerSession(db,q,{...input,loadKey:directoryBrokerKeys(directory)});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stderr.write('BROKER_UNAVAILABLE\n');process.exitCode=1}finally{await q.close();await db.$disconnect()}
