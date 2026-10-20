import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const password=(await readFile('/run/secrets/database_password','utf8')).trim();
process.env.DATABASE_URL='postgresql://vcp:'+encodeURIComponent(password)+'@postgres:5432/vcp';
const mode=process.argv[2];
const paths={api:'apps/api/dist/main.js',worker:'apps/worker/dist/main.js',scheduler:'apps/worker/dist/scheduler-main.js',migrate:'packages/database/node_modules/prisma/build/index.js',seed:'packages/database/dist/seed.js'};
if(!(mode in paths))throw new Error('Invalid container mode');
const args=mode==='migrate'?[paths[mode],'migrate','deploy','--schema','packages/database/prisma/schema.prisma']:[paths[mode]];
const result=spawnSync(process.execPath,args,{env:process.env,stdio:'inherit'});process.exit(result.status??1);
