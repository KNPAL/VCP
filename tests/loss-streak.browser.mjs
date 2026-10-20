import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('loss-streak panel keeps allocation retries stable, displays evidence and handles service loss',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const password=(await readFile('.runtime/owner-password','utf8')).trim(),login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:'owner',password}});assert.equal(login.status(),201);const auth=await login.json(),page=await context.newPage();
  const cashId='11111111-1111-4111-8111-111111111111',episodeId='22222222-2222-4222-8222-222222222222',at=new Date().toISOString();let fail=true,down=false;const writes=[];
  let model={state:'UNKNOWN',streak:null,asOf:at,reasons:['POSITION_CASH_ATTRIBUTION_REQUIRED'],unallocatedCashEventIds:[cashId],cooldown:null,episodes:[{id:episodeId,isin:'INE000000001',closedAt:at,quantity:0,netPnl:null,cashEventIds:[]}],allocationHistory:[]};
  await page.route('**/api/v1/portfolio',route=>route.fulfill({json:{cash:'1000.000000',asOf:new Date().toISOString(),equity:null,realizedPnl:'-1.000000',positions:[],lots:[],events:[{id:cashId,kind:'CORPORATE_CREDIT',amount:'2',occurredAt:at,recordedAt:at,sourceId:'synthetic'}],reversed:[]}}));
  await page.route('**/api/v1/portfolio/loss-streak',route=>down?route.fulfill({status:503,json:{}}):route.fulfill({json:model}));
  await page.route('**/api/v1/portfolio/cash-allocations',async route=>{
   const payload=route.request().postDataJSON();writes.push({payload,key:route.request().headers()['idempotency-key']});assert.equal(route.request().headers()['x-csrf-token'],auth.csrfToken);
   if(fail)return route.fulfill({status:503,json:{}});
   model={...model,state:'PASS',streak:0,reasons:[],unallocatedCashEventIds:[],episodes:[{...model.episodes[0],netPnl:'1.000000',cashEventIds:[cashId]}],allocationHistory:[{...payload,id:'allocation',recordedAt:at}]};
   return route.fulfill({status:201,json:model.allocationHistory[0]});
  });
  await page.goto('/positions');const panel=page.getByRole('region',{name:'Loss-streak protection'});
  await panel.getByText('POSITION_CASH_ATTRIBUTION_REQUIRED',{exact:false}).waitFor();
  await panel.getByLabel('Cash event',{exact:true}).selectOption(cashId);await panel.getByLabel('Position episode',{exact:true}).selectOption(episodeId);await panel.getByLabel('Allocation reason').fill('Verified corporate credit');await panel.getByRole('checkbox').check();
  await panel.getByRole('button',{name:'Record cash allocation',exact:true}).click();await panel.getByRole('alert').waitFor();
  fail=false;await panel.getByRole('button',{name:'Record cash allocation',exact:true}).click();await panel.getByText('₹ 1.000000',{exact:true}).waitFor();
  assert.equal(writes.length,2);assert.equal(writes[0].key,writes[1].key);assert.deepEqual(writes[1].payload,{cashEventId:cashId,episodeId,reason:'Verified corporate credit'});
  await panel.locator('summary').click();await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  down=true;await page.getByRole('button',{name:'Refresh journal'}).click();await panel.getByText('UNKNOWN',{exact:true}).waitFor();
  await context.request.post('/api/v1/auth/logout',{headers:{origin:base,'x-csrf-token':auth.csrfToken}});
 }finally{await context.close();await browser.close()}
});


