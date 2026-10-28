import {readFile,stat} from 'node:fs/promises';
import {PrismaClient,importInstrumentMaster} from '../packages/database/dist/index.js';
const [mode,path]=process.argv.slice(2);
if(mode!=='import'||!path||!process.env.DATABASE_URL)throw new Error('Usage: instrument-master.mjs import <reviewed-json>; DATABASE_URL required');
if((await stat(path)).size>100*1024*1024)throw new Error('MASTER_INPUT_TOO_LARGE');
const db=new PrismaClient();try{const result=await importInstrumentMaster(db,JSON.parse(await readFile(path,'utf8')));console.log(JSON.stringify(result));if(result.status==='PARTIAL')process.exitCode=2}finally{await db.$disconnect()}
