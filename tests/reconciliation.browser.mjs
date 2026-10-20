import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('statement UI records independent evidence, retains retry identity and displays discrepancies',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base='http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const password=(await readFile('.runtime/owner-password','utf8')).trim(),login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:'owner',password}});assert.equal(login.status(),201);const auth=await login.json(),page=await context.newPage();let fail=true,model={state:'PORTFOLIO_UNRECONCILED',reasons:['RECONCILIATION_REQUIRED'],latest:null,history:[]};const writes=[];
  await page.route('**/api/v1/portfolio/reconciliation',async route=>{
   if(route.request().method()==='POST'){
    const payload=route.request().postDataJSON();writes.push({payload,key:route.request().headers()['idempotency-key']});assert.equal(route.request().headers()['x-csrf-token'],auth.csrfToken);
    if(fail)return route.fulfill({status:503,json:{error:{message:'Statement service unavailable'}}});
    const result={state:'PORTFOLIO_UNRECONCILED',quantities:[{isin:'INE000000001',journal:0,statement:10}],missingInJournal:['outside-fill'],missingInStatement:[]};model={state:result.state,reasons:['OUTSIDE_HOLDINGS_MISMATCH','FILL_REFERENCE_MISMATCH'],latest:{id:'fixture',statement:payload,result},history:[{id:'fixture',statement:payload,result}]};return route.fulfill({status:201,json:model.latest});
   }return route.fulfill({json:model});
  });
  await page.goto('/positions');const panel=page.getByRole('region',{name:'Broker reconciliation'});await panel.getByText('RECONCILIATION_REQUIRED',{exact:false}).waitFor();
  await panel.getByLabel('Statement source reference').fill('Independent statement');await panel.getByLabel('Statement cash (INR)').fill('100.123456');await panel.getByRole('button',{name:'Use current timestamp'}).click();await panel.getByLabel('All statement holdings',{exact:false}).fill('INE000000001 10');await panel.getByLabel('All executed fill references',{exact:false}).fill('outside-fill');await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Record reconciliation',exact:true}).click();await panel.getByRole('alert').waitFor();
  fail=false;await panel.getByRole('button',{name:'Record reconciliation',exact:true}).click();await panel.getByText('INE000000001: journal 0 shares; statement 10 shares',{exact:true}).waitFor();assert.equal(writes.length,2);assert.equal(writes[0].key,writes[1].key);assert.equal(writes[1].payload.cash,'100.123456');assert.deepEqual(writes[1].payload.holdings,[{isin:'INE000000001',quantity:10}]);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await panel.getByRole('button',{name:'Record reconciliation',exact:true}).focus();await page.keyboard.press('Tab');
  await context.request.post('/api/v1/auth/logout',{headers:{origin:base,'x-csrf-token':auth.csrfToken}});
 }finally{await context.close();await browser.close()}
});
