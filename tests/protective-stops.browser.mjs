import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('protective observations display actual gap price without claiming fills and retain outage warning',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base='http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const password=(await readFile('.runtime/owner-password','utf8')).trim(),login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:'owner',password}});assert.equal(login.status(),201);const auth=await login.json(),page=await context.newPage();let down=false;
  await page.route('**/api/v1/positions/stops',route=>down?route.fulfill({status:503,json:{error:{message:'Unavailable'}}}):route.fulfill({json:{items:[{isin:'INE000000001',quantity:10,state:'KNOWN',reason:null,record:{stop:{activeStop:'94.950000'},recordedAt:new Date().toISOString()}},{isin:'INE000000002',quantity:5,state:'UNKNOWN',reason:'PRICE_SCALE_UNVERIFIED',record:null}],signals:[{id:'fixture',isin:'INE000000001',quantity:10,triggeredPrice:'90.000000',activeStop:'94.950000',observedTickAt:new Date().toISOString(),recognizedAt:new Date().toISOString(),quality:'FRESH'}]}}));
  await page.goto('/positions');const panel=page.getByRole('region',{name:'Protective stop evidence'});await panel.getByText('SELL PROTECTIVE · INE000000001',{exact:true}).waitFor();assert.match(await panel.innerText(),/Observed price ₹ 90.000000/);assert.match(await panel.innerText(),/PRICE SCALE UNVERIFIED/);assert.match(await panel.innerText(),/does not confirm execution/);assert.match(await panel.innerText(),/10 current shares/);
  down=true;await panel.getByRole('alert').waitFor({timeout:10000});assert.match(await panel.getByRole('alert').innerText(),/current protection is unknown/);await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await context.request.post('/api/v1/auth/logout',{headers:{origin:base,'x-csrf-token':auth.csrfToken}});
 }finally{await context.close();await browser.close()}
});
