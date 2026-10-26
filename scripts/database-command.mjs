import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const password=(await readFile('.runtime/database-password','utf8')).trim();
const mode=process.argv[2];
if(!['migrate','seed','test','test-web','scan'].includes(mode))throw new Error('Expected migrate, seed, test, test-web or scan');
const database=['test','test-web'].includes(mode)?'vcp_test':'vcp';
const env={...process.env,DATABASE_URL:'postgresql://vcp:'+encodeURIComponent(password)+'@127.0.0.1:55432/'+database,OWNER_LOGIN:'owner',OWNER_PASSWORD_FILE:new URL('../.runtime/owner-password',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')};
const prisma='packages/database/node_modules/prisma/build/index.js';
function run(args){const r=spawnSync(process.execPath,args,{env,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
if(mode==='migrate'||mode==='test')run([prisma,'migrate','deploy','--schema','packages/database/prisma/schema.prisma']);
if(mode==='seed')run(['packages/database/dist/seed.js']);
if(mode==='scan')run(['scripts/prepare-eod-scan.mjs',...process.argv.slice(3)]);
if(mode==='test'){
 const suites=['database','eod-scan','indicator-replay','rs-replay','scheduler','alerts','lifecycle','position-monitor','reconciliation','protective-stops','portfolio-risk','entry-risk','loss-streak','shadow-audit','position-trail','partial-profit','position-status','stream-context','stream','backtest-snapshot','backtest-results','data-health','download-preview','dashboard','inspector','position-cards','position-detail','ipo-research','sme-research'],requested=process.argv.slice(3);
 if(requested.some(name=>!suites.includes(name)))throw new Error('Unknown integration suite');
 run(['--test','--test-concurrency=1',...(requested.length?requested:suites).map(name=>'tests/'+name+'.integration.mjs')]);
}
if(mode==='test-web')run(['scripts/ci-web-test.mjs']);
