import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// Only use a disposable, explicitly named smoke stack. Suppress response bodies:
// the successful login contains an owner session cookie and a CSRF token.
const project=process.env.VCP_SMOKE_PROJECT;
if(!['vcp-ci-smoke','vcp-kan4-clean'].includes(project))throw new Error('Expected a disposable smoke project');
const files=['infra/compose.yml','infra/compose.app.yml'];
if(project==='vcp-kan4-clean')files.push('infra/compose.smoke.yml');
const base=['compose','-p',project,...files.flatMap(file=>['-f',file])];
function run(args,input){
 const result=spawnSync('docker',[...base,...args],{encoding:'utf8',input,timeout:90000});
 if(result.status!==0)throw new Error('Smoke command failed: '+args[0]);
 return result.stdout;
}
const file=resolve('.runtime/owner-password'),login='smoke-owner';
run(['run','--rm','--no-deps','-v',file+':/run/secrets/smoke_owner:ro','-e','OWNER_LOGIN='+login,'-e','OWNER_PASSWORD_FILE=/run/secrets/smoke_owner','migrate','node','scripts/container-start.mjs','seed']);
const curl=['exec','-T','proxy','curl','--silent','--show-error','--cacert','/data/caddy/pki/authorities/local/root.crt','--max-time','15'];
const origin='https://localhost:8443',jar='/tmp/vcp-smoke-session';
try{
 const status=run([...curl,'--output','/dev/null','--write-out','%{http_code}','--cookie-jar',jar,'--header','Origin: '+origin,'--header','Content-Type: application/json','--data-binary','@-',origin+'/api/v1/auth/login'],JSON.stringify({login,password:(await readFile(file,'utf8')).trim()}));
 assert.equal(status,'201','Owner login through TLS');
 const session=JSON.parse(run([...curl,'--cookie',jar,origin+'/api/v1/auth/session']));
 assert.equal(session.owner.login,login);
 const response=run([...curl,'--cookie',jar,'--output','/dev/null','--write-out','%{http_code}',origin+'/dashboard']);
 assert.equal(response,'200','Authenticated workspace through TLS');
 console.log('Verified TLS owner login, session and dashboard.');
}finally{run(['exec','-T','proxy','rm','-f',jar])}
