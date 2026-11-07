import {prepareLocalBroker} from './local-broker-setup.mjs';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const mode=process.argv[2];
if(!['api','web','worker','scheduler'].includes(mode))throw new Error('Expected api, web, worker or scheduler');
const webPort=Number(process.env.VCP_WEB_PORT??3000);
if(!Number.isSafeInteger(webPort)||webPort<1||webPort>65535||webPort===3001)throw new Error('Invalid VCP_WEB_PORT');
const password=(await readFile('.runtime/database-password','utf8')).trim();
const broker=await prepareLocalBroker();
const env={...broker,...process.env,API_HOST:'127.0.0.1',WEB_HOST:'127.0.0.1',VCP_ALLOW_LOCAL_BROKER_HTTP:'true',DATABASE_URL:'postgresql://vcp:'+encodeURIComponent(password)+'@127.0.0.1:55432/vcp',REDIS_HOST:'127.0.0.1',REDIS_PORT:'56379',APP_ORIGIN:'http://localhost:'+webPort,COOKIE_SECURE:'false',NODE_ENV:mode==='web'?'production':'development'};
const child=spawn(process.execPath,mode==='web'?['scripts/web-server.mjs']:mode==='scheduler'?['apps/worker/dist/scheduler-main.js']:['apps/'+mode+'/dist/main.js'],{cwd:process.cwd(),env,stdio:'inherit'});
child.on('exit',code=>process.exit(code??1));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));

