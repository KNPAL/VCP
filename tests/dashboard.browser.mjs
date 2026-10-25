import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('dashboard displays evidence, expires observations, and handles loading, empty and HTTP failures',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}});assert.equal(login.status(),201);
  const auth=await login.json(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let mode='normal';const now=new Date().toISOString(),future=new Date(Date.now()+60000).toISOString(),old='2020-01-01T12:00:00Z',scanId='00000000-0000-4000-8000-000000000001';
  const fixture={asOf:now,scanReason:null,scan:{scanId,asOf:old,status:'PARTIAL',counts:{intended:500,analyzed:470,missing:20,excluded:10,rejected:12},signals:{WATCH:100,READY:30,BUY_MARKET_SIGNAL:5}},progress:{scanId,asOf:now,intended:500,processed:250,finished:false},risk:{asOf:now,validUntil:future,journalHash:'fixture',journal:{state:'KNOWN',holdings:{INE000000001:3,INE000000002:4}},valuation:{state:'KNOWN',cash:'1000.000000',equity:'1500.000000',grossExposure:'500.000000',positionCount:2},actualRisk:{regimeEvidence:{regime:'YELLOW',reasons:[],scanId,validUntil:future,evidence:{asOf:now,session:now.slice(0,10)}}},reasons:[],reconciliation:{state:'RECONCILED_AS_OF'}},statuses:{asOf:now,items:[{current:true,evidence:{id:'fresh',isin:'INE000000001',asOf:now,validUntil:future},result:{action:'SELL_PROTECTIVE',lifecycle:'EXIT_ALERTED',health:'FEED_FRESH',reasons:[]}},{current:false,evidence:{id:'stale',isin:'INE000000002',asOf:old,validUntil:old},result:{action:'SELL_PROTECTIVE',lifecycle:'EXIT_ALERTED',health:'MONITOR_DEGRADED',reasons:[]}}]},readiness:{asOf:now,buyAllowed:false,monitoring:'MONITOR_DEGRADED',items:[{gate:'G04',status:'PASS',reason:null,proof:{sourceAt:now,expiresAt:future}}]}};
  await page.route('**/api/v1/portfolio/dashboard',async route=>{
   if(['403','503'].includes(mode))return route.fulfill({status:Number(mode),json:{}});
   if(mode==='loading')await new Promise(r=>setTimeout(r,600));
   const data=structuredClone(fixture);
   if(mode==='empty'){data.scan=null;data.progress=null;data.scanReason='NO_COMPLETED_SCAN';data.risk.journal.holdings={};data.statuses.items=[];data.risk.actualRisk.regimeEvidence.regime='UNKNOWN'}
   if(mode==='expired'){data.risk.validUntil=old;data.risk.actualRisk.regimeEvidence.validUntil=old;data.readiness.items[0].proof.expiresAt=old}
   return route.fulfill({json:data});
  });
  await page.goto('/dashboard');const main=page.locator('main');await page.getByRole('heading',{name:'Scan coverage',exact:true}).waitFor();
  assert.match(await main.innerText(),/Processed 250 \/ intended 500/);assert.match(await main.innerText(),/Analyzed 470 \/ intended 500/);assert.match(await main.innerText(),/Current urgent SELL alerts: 1/);assert.match(await main.innerText(),/UNKNOWN monitoring: 1/);assert.match(await main.innerText(),/STALE/);assert.match(await main.innerText(),/IST.*raw source age:/);assert.equal(await page.getByRole('link',{name:'Immutable scan evidence'}).getAttribute('href'),'/api/v1/system/scans/'+scanId);
  await page.screenshot({path:'.runtime/dashboard-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.runtime/dashboard-mobile.png',fullPage:true});await page.getByRole('button',{name:'Refresh dashboard'}).focus();assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Refresh dashboard');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'A');
  for(const code of ['403','503']){mode=code;await page.getByRole('button',{name:'Refresh dashboard'}).click();await main.getByRole('alert').waitFor();assert.match(await main.getByRole('alert').innerText(),new RegExp(code));assert.equal(await page.getByRole('heading',{name:'Scan coverage',exact:true}).count(),0)}
  mode='empty';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('No open positions recorded.',{exact:true}).waitFor();assert.match(await main.innerText(),/UNKNOWN — No usable completed scan/);
  mode='loading';await page.getByRole('button',{name:'Refresh dashboard'}).click();await page.getByText('Loading dashboard evidence…',{exact:true}).waitFor();await page.getByRole('heading',{name:'Scan coverage',exact:true}).waitFor();
  mode='expired';await page.getByRole('button',{name:'Refresh dashboard'}).click();await page.getByText('Regime assessment expired or unavailable.',{exact:false}).waitFor();assert.match(await main.innerText(),/Current urgent SELL alerts: UNKNOWN/);assert.match(await main.innerText(),/UNKNOWN — EXPIRED/);assert.deepEqual(errors,[]);
  await context.request.post('/api/v1/auth/logout',{headers:{origin:base,'x-csrf-token':auth.csrfToken}});
 }finally{await context.close();await browser.close()}
});
