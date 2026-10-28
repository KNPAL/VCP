import {readFile,stat} from 'node:fs/promises';
import {PrismaClient,persistSource,readSourceRegistry,persistReadiness} from '../packages/database/dist/index.js';
const [mode,arg]=process.argv.slice(2);if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');const db=new PrismaClient();
try{
 if(mode==='import'&&arg){if((await stat(arg)).size>65536)throw new Error('SOURCE_METADATA_TOO_LARGE');const source=JSON.parse(await readFile(arg,'utf8'));console.log(JSON.stringify(await persistSource(db,source)))}
 else if(mode==='proof'&&arg){if((await stat(arg)).size>65536)throw new Error('SOURCE_METADATA_TOO_LARGE');const proof=JSON.parse(await readFile(arg,'utf8'));if(proof.gate!=='G07')throw new Error('G07_PROOF_REQUIRED');console.log(JSON.stringify(await persistReadiness(db,proof)))}
 else if(mode==='view')console.log(JSON.stringify(await readSourceRegistry(db,arg),null,2));
 else throw new Error('Usage: source-registry.mjs import <reviewed-metadata.json> | proof <reviewed-g07.json> | view [dataset]');
}finally{await db.$disconnect()}
