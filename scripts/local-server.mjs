import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const mode=process.argv[2];
if(!['api','web'].includes(mode))throw new Error('Expected api or web');
const password=(await readFile('.runtime/database-password','utf8')).trim();
const env={...process.env,DATABASE_URL:'postgresql://vcp:'+encodeURIComponent(password)+'@127.0.0.1:55432/vcp',APP_ORIGIN:'http://localhost:3000',COOKIE_SECURE:'false',NODE_ENV:mode==='web'?'production':'development'};
const child=spawn(process.execPath,mode==='api'?['apps/api/dist/main.js']:['node_modules/next/dist/bin/next','start','-p','3000'],{cwd:mode==='api'?process.cwd():process.cwd()+'/apps/web',env,stdio:'inherit'});
child.on('exit',code=>process.exit(code??1));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
