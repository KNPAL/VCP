import {readFile} from 'node:fs/promises';
import {PrismaClient,persistSurveillance,readSurveillance} from '../packages/database/dist/index.js';
const [mode,arg]=process.argv.slice(2);if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');const db=new PrismaClient();
try{
 if(mode==='import'&&arg){const input=await readFile(arg,'utf8');if(Buffer.byteLength(input)>65536)throw new Error('SURVEILLANCE_INPUT_TOO_LARGE');console.log(JSON.stringify(await persistSurveillance(db,JSON.parse(input))))}
 else if(mode==='view'&&arg)console.log(JSON.stringify(await readSurveillance(db,arg),null,2));
 else throw new Error('Usage: surveillance.mjs import <reviewed-json> | view <listing-uuid>');
}finally{await db.$disconnect()}
