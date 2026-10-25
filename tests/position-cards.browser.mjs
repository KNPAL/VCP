import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('position cards show exact server metrics, quote expiry and accessible empty/error states',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}});assert.equal(login.status(),201);const auth=await login.json(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let mode='normal';
  const now=new Date().toISOString(),future=new Date(Date.now()+120000).toISOString(),old='2020-01-01T12:00:00Z',item={isin:'INE000000001',quantity:2,remainingEntry:'100.000000',costBasis:'202.000000',realizedPnl:'8.000000',unrealizedPnl:'18.000000',initialEntry:'100.000000',initialStop:'90.000000',activeStop:'95.000000',mark:'110.000000',markAt:now,companyExposure:'220.000000',sector:'TECH',sectorExposure:'220.000000',ema21:'105.000000',emaSourceAt:now,executionId:null,r0:'10.000000',rMultiple:'1.00000000',status:'HOLD',monitoring:'FEED_FRESH',statusAt:now,statusValidUntil:future,riskStatus:'WITHIN_OBSERVED_CAPS',reasons:[]};
  await page.route('**/api/v1/positions/cards',async route=>{
   assert.equal(route.request().method(),'GET');if(['403','503'].includes(mode))return route.fulfill({status:Number(mode),json:{}});if(mode==='loading')await new Promise(r=>setTimeout(r,500));
   const data={asOf:now,validUntil:mode==='stale'?old:future,state:mode==='unknown'?'UNKNOWN':'KNOWN',items:mode==='empty'||mode==='unknown'?[]:[{...item,markAt:mode==='stale'?old:now}]};return route.fulfill({json:data});
  });
  await page.goto('/positions');const region=page.getByRole('region',{name:'Actual open position cards',exact:true});await region.getByRole('heading',{name:'INE000000001 · 2 shares',exact:true}).waitFor();
  assert.match(await region.innerText(),/18.000000/);assert.match(await region.innerText(),/1.00000000/);assert.match(await region.innerText(),/FEED_FRESH · HOLD/);assert.match(await region.innerText(),/raw source age: \d+ seconds/);assert.match(await region.innerText(),/Remaining FIFO cost/);
  await region.getByText('Risk evidence and reasons',{exact:true}).focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Position evidence');
  await region.screenshot({path:'.runtime/position-cards-desktop.png'});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await region.locator('dd').evaluateAll(items=>items.every(item=>item.getBoundingClientRect().height<22)));await region.screenshot({path:'.runtime/position-cards-mobile.png'});
  mode='stale';await region.getByRole('button',{name:'Refresh position cards',exact:true}).click();await region.getByText('STALE — valuation observation expired. Live values remain UNKNOWN until refreshed.',{exact:true}).waitFor();assert.match(await region.innerText(),/MONITOR_DEGRADED/);assert.equal(await region.getByText('18.000000',{exact:true}).count(),0);assert.equal(await region.getByText('1.00000000',{exact:true}).count(),0);
  for(const code of ['403','503']){mode=code;await region.getByRole('button',{name:'Refresh position cards',exact:true}).click();await region.getByRole('alert').waitFor();assert.match(await region.getByRole('alert').innerText(),new RegExp(code));assert.equal(await region.getByRole('article').count(),0)}
  mode='empty';await region.getByRole('button',{name:'Retry position cards',exact:true}).click();await region.getByText('No actual open holdings. An unrecorded BUY signal is not a position.',{exact:true}).waitFor();
  mode='unknown';await region.getByRole('button',{name:'Refresh position cards',exact:true}).click();await region.getByText('UNKNOWN — verified initial capital and journal evidence required.',{exact:true}).waitFor();
  mode='loading';await region.getByRole('button',{name:'Refresh position cards',exact:true}).click();await region.getByText('Loading position cards…',{exact:true}).waitFor();await region.getByRole('heading',{name:'INE000000001 · 2 shares',exact:true}).waitFor();assert.deepEqual(errors,[]);
  await context.request.post('/api/v1/auth/logout',{headers:{origin:base,'x-csrf-token':auth.csrfToken}});
 }finally{await context.close();await browser.close()}
});
