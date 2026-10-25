import {readFile} from 'node:fs/promises';
import {PrismaClient,persistSmeResearch,listSmeResearch,readSmeResearch} from '../packages/database/dist/index.js';
const [mode,arg]=process.argv.slice(2);if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');const db=new PrismaClient();
try{
 if(mode==='import'&&arg){const input=await readFile(arg,'utf8');if(Buffer.byteLength(input)>65536)throw new Error('SME_METADATA_TOO_LARGE');console.log(JSON.stringify(await persistSmeResearch(db,JSON.parse(input))))}
 else if(mode==='list'&&!arg)console.log(JSON.stringify(await listSmeResearch(db),null,2));
 else if(mode==='view'&&arg)console.log(JSON.stringify(await readSmeResearch(db,arg),null,2));
 else throw new Error('Usage: sme-research.mjs import <reviewed-json> | list | view <listing-uuid>');
}finally{await db.$disconnect()}
