import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('all UI shell routes enforce login and render after authentication',async()=>{
 const base=process.env.WEB_TEST_BASE_URL??'http://localhost:3000';
 const routes=['dashboard','universe','screener','inspector','buy','positions','watchlists','sell','backtests','settings','operations','settings/broker/angel-one','data/historical/download','data/historical/downloads','data/historical/downloads/example'];
 for(const route of routes){const r=await fetch(base+'/'+route,{redirect:'manual'});assert.equal(r.status,307,route);assert.equal(r.headers.get('location'),'/login');}
 const password=process.env.WEB_TEST_PASSWORD??(await readFile('.runtime/owner-password','utf8')).trim();
 const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({login:process.env.WEB_TEST_LOGIN??'owner',password})});
 assert.equal(login.status,201);const cookie=login.headers.get('set-cookie').split(';')[0];const session=await login.json();
 try{for(const route of routes){const r=await fetch(base+'/'+route,{headers:{cookie}});assert.equal(r.status,200,route);const html=await r.text();assert.ok(html.includes('Skip to content'),route);assert.ok(html.includes(route==='positions'?'New BUY plans remain blocked':'Source freshness'),route);}}
 finally{const r=await fetch(base+'/api/v1/auth/logout',{method:'POST',headers:{cookie,origin:base,'x-csrf-token':session.csrfToken}});assert.equal(r.status,201);}
});


