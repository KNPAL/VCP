import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ST_VCP_4_0,PROFILE_VERSION,configurationHash} from '../packages/strategy/dist/index.js';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('profile settings distinguish unknown, immutable drafts and failures on mobile',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.VCP_BROWSER_CHANNEL?{channel:process.env.VCP_BROWSER_CHANNEL}:{})});const base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const password=process.env.WEB_TEST_PASSWORD??(await readFile('.runtime/owner-password','utf8')).trim();const login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN??'owner',password}});assert.equal(login.status(),201);const auth=await login.json(),page=await context.newPage();
  const model={asOf:new Date().toISOString(),activeId:null,defaultVersion:PROFILE_VERSION,defaultConfiguration:ST_VCP_4_0,executionSupportedHash:configurationHash(ST_VCP_4_0),items:[],activations:[]};let mode='normal';const writes=[];
  await page.route('**/api/v1/vcp/profiles',async route=>{
   if(mode==='503')return route.fulfill({status:503,json:{error:{message:'Unavailable'}}});
   if(route.request().method()==='POST'){const input=route.request().postDataJSON();writes.push(input);assert.equal(route.request().headers()['x-csrf-token'],auth.csrfToken);const item={...input,id:configurationHash(input.configuration),createdAt:model.asOf,executionSupported:false};if(!model.items.some(p=>p.id===item.id))model.items.push(item);return route.fulfill({status:201,json:{id:item.id,activationChanged:false}})}
   if(mode==='loading')await new Promise(r=>setTimeout(r,500));return route.fulfill({json:model});
  });
  await page.goto('/settings');await page.getByText('UNKNOWN — No registered versions yet.').waitFor();assert.match(await page.locator('main').innerText(),/±3 pivot confirmation/);assert.match(await page.locator('main').innerText(),/EMA21 \+ 0.5 ATR/);
  await page.getByLabel('New version name').fill('ST_VCP_BROWSER_TEST');await page.getByLabel('Configuration JSON').fill('{bad');await page.getByRole('button',{name:'Save new version',exact:true}).click();await page.getByRole('alert').filter({hasText:'Invalid JSON'}).waitFor();assert.equal(writes.length,0);
  await page.getByLabel('Configuration JSON').fill(JSON.stringify({...ST_VCP_4_0,baselineRisk:'0.003'}));await page.getByRole('button',{name:'Save new version',exact:true}).click();await page.getByText('Immutable version saved. Active configuration and historic scan hashes are unchanged.').waitFor();assert.equal(writes[0].configuration.version,'ST_VCP_BROWSER_TEST');await page.getByText('Draft — execution unsupported',{exact:false}).waitFor();assert.equal(model.activeId,null);
  mode='503';await page.getByRole('button',{name:'Refresh profiles'}).click();await page.locator('main').getByRole('alert').waitFor();assert.match(await page.locator('main').getByRole('alert').innerText(),/503/);
  mode='loading';await page.getByRole('button',{name:'Refresh profiles'}).click();await page.getByText('Loading strategy profiles…').waitFor();await page.getByRole('heading',{name:'Profile history'}).waitFor();
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.getByLabel('Inspect version',{exact:true}).focus();await page.keyboard.press('Tab');
  await context.request.post('/api/v1/auth/logout',{headers:{origin:base,'x-csrf-token':auth.csrfToken}});
 }finally{await context.close();await browser.close()}
});
