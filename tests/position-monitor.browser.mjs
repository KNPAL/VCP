import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('held positions show outages, recovery history and fail closed when API disappears',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const password=(await readFile('.runtime/owner-password','utf8')).trim(),login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:'owner',password}});assert.equal(login.status(),201);const auth=await login.json(),page=await context.newPage();let mode='degraded';
  await page.route('**/api/v1/portfolio',async route=>{
   if(mode==='down')return route.fulfill({status:503,json:{error:{message:'Unavailable'}}});
   const now=new Date().toISOString(),isin='INE000000001';
   return route.fulfill({json:{cash:'1000.000000',asOf:now,equity:null,realizedPnl:'0.000000',positions:[{isin,quantity:10,costBasis:'100.000000',realizedPnl:'0.000000'}],lots:[],events:[],reversed:[],monitor:{items:[{isin,state:mode==='fresh'?'FEED_FRESH':'MONITOR_DEGRADED',reason:mode==='fresh'?'QUOTE_AND_CONNECTION_CURRENT':'FEED_DISCONNECTED',asOf:now,validUntil:new Date(Date.now()+30000).toISOString(),sourceAt:mode==='fresh'?now:null,gapStartedAt:mode==='fresh'?null:now}],events:[{id:'test-gap',isin,kind:'MONITOR_RECOVERED',reason:'QUOTE_AND_CONNECTION_CURRENT',eventAt:now,gapStartedAt:now,gapEndedAt:now}]}}});
  });
  await page.goto('/positions');const panel=page.getByRole('region',{name:'Position feed monitoring'});await panel.getByRole('alert').waitFor();assert.match(await panel.innerText(),/10 shares · MONITOR DEGRADED/);
  mode='fresh';await page.getByRole('button',{name:'Refresh journal'}).click();await panel.getByText('INE000000001 · 10 shares · FEED FRESH',{exact:true}).waitFor();await panel.locator('summary').click();assert.match(await panel.innerText(),/Gap/);
  mode='down';await panel.getByText('Current monitoring evidence unavailable.',{exact:true}).waitFor({timeout:10000});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await context.request.post('/api/v1/auth/logout',{headers:{origin:base,'x-csrf-token':auth.csrfToken}});
 }finally{await context.close();await browser.close()}
});

