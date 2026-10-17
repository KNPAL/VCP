import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const password=(await readFile('.runtime/database-password','utf8')).trim();
const mode=process.argv[2];
if(!['migrate','seed','test'].includes(mode))throw new Error('Expected migrate, seed or test');
const database=mode==='test'?'vcp_test':'vcp';
const env={...process.env,DATABASE_URL:'postgresql://vcp:'+encodeURIComponent(password)+'@127.0.0.1:55432/'+database,OWNER_LOGIN:'owner',OWNER_PASSWORD_FILE:new URL('../.runtime/owner-password',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')};
const prisma='packages/database/node_modules/prisma/build/index.js';
function run(args){const r=spawnSync(process.execPath,args,{env,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
if(mode==='migrate'||mode==='test')run([prisma,'migrate','deploy','--schema','packages/database/prisma/schema.prisma']);
if(mode==='seed')run(['packages/database/dist/seed.js']);
if(mode==='test')run(['--test','tests/database.integration.mjs']);
