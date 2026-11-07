import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
const webPort=Number(process.env.VCP_WEB_PORT??3000);
if(!Number.isSafeInteger(webPort)||webPort<1||webPort>65535||webPort===3001)throw new Error('Invalid VCP_WEB_PORT');
for(const port of [3001,webPort])await new Promise((resolve,reject)=>{const server=createServer();server.once('error',()=>reject(new Error('Port '+port+' is occupied. Stop the previous VCP preview or choose another VCP_WEB_PORT.')));server.listen(port,'127.0.0.1',()=>server.close(resolve))});
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit'});if(result.status!==0)throw new Error('Startup prerequisite failed: '+command)}
run(process.execPath,['scripts/init-local.mjs']);
const running=spawnSync('docker',['ps','--filter','label=com.docker.compose.project=study-trade-vcp','--format','{{.Label "com.docker.compose.service"}}'],{encoding:'utf8'});
if(running.status!==0)throw new Error('Docker is unavailable. Start Docker Desktop and retry.');
if(running.stdout.split(/\r?\n/).some(service=>['api','web','worker','proxy'].includes(service.trim())))throw new Error('The VCP Docker application is already running. Stop its api, web, worker and proxy services as described in README before starting the local application.');
run('docker',['compose','-p','study-trade-vcp','-f','infra/compose.yml','-f','infra/compose.dev.yml','up','-d','--wait','postgres','redis']);
run(process.execPath,['scripts/database-command.mjs','migrate']);
run(process.execPath,['scripts/database-command.mjs','seed']);
const children=['api','worker','web'].map(mode=>spawn(process.execPath,['scripts/local-server.mjs',mode],{stdio:'inherit'}));
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;process.exitCode=code;for(const child of children)if(child.exitCode===null)child.kill('SIGTERM')}
for(const child of children){child.on('error',()=>stop(1));child.on('exit',code=>{if(!stopping)stop(code??1)})}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
console.log('Starting VCP. Once the web server is ready, open http://localhost:'+webPort+'/login, then Configuration.');
