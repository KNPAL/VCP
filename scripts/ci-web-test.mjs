import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
const url=new URL(process.env.DATABASE_URL??'http://invalid');
if(url.pathname!=='/vcp_test')throw new Error('UI integration runner requires the isolated vcp_test database');
for(const port of [3000,3001])await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve))});
const common={...process.env,APP_ORIGIN:'http://localhost:3000',COOKIE_SECURE:'false',API_INTERNAL_URL:'http://127.0.0.1:3001'};
const children=[];
function start(args,options){const child=spawn(process.execPath,args,{stdio:'inherit',...options});children.push(child);return child}
let result;
try{
 const api=start(['apps/api/dist/main.js'],{env:{...common,NODE_ENV:'development'}});
 const web=start(['node_modules/next/dist/bin/next','start','-p','3000','-H','127.0.0.1'],{cwd:'apps/web',env:{...common,NODE_ENV:'production'}});
 const deadline=Date.now()+30000;let ready=false;
 while(Date.now()<deadline){if(api.exitCode!==null||web.exitCode!==null)throw new Error('Preview process exited early');try{ready=(await fetch('http://127.0.0.1:3001/api/v1/system/health')).ok&&(await fetch('http://127.0.0.1:3000/login')).ok}catch{/* Services may still be binding their ports. */}if(ready)break;await new Promise(resolve=>setTimeout(resolve,200))}
 if(!ready)throw new Error('Preview readiness timeout');
 const test=start(['--test','tests/web.integration.mjs'],{env:{...common,WEB_TEST_LOGIN:'integration-owner',WEB_TEST_PASSWORD:'synthetic-test-password-2026'}});
 result=await new Promise(resolve=>test.once('exit',code=>resolve(code??1)));
}finally{
 for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');
 await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},5000);child.once('exit',()=>{clearTimeout(timer);resolve()})})));
}
process.exitCode=result;
