import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('BUY evidence separates market confirmation, expiring owner plans and manual execution',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL,context=await browser.newContext({baseURL:base});
 try{
  assert.equal((await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}})).status(),201);
  const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));let mode='normal',evaluated=false;const id='a'.repeat(64),snapshotId='b'.repeat(64);
  await page.route('**/api/v1/portfolio/**',async route=>{
   const request=route.request(),now=new Date().toISOString(),future=new Date(Date.now()+30000).toISOString();
   if(request.method()==='POST'){assert.ok(request.headers()['x-csrf-token']);assert.ok(request.headers()['idempotency-key']);writes.push(request.postDataJSON());evaluated=true;return route.fulfill({status:201,json:{}})}
   if(mode==='403'||mode==='503')return route.fulfill({status:Number(mode),json:{}});
   if(request.url().endsWith('/risk'))return route.fulfill({json:{snapshotId,validUntil:future}});
   if(request.url().endsWith('/risk/plans'))return route.fulfill({json:{items:evaluated?[{current:true,validityReasons:[],evidence:{id:'plan',marketEventId:id,state:'BUY_BLOCKED',quantity:0,stop:'95',isin:'INE000000001',asOf:now,expiresAt:mode==='expired'?'2020-01-01T00:00:00Z':future,reasons:['G06_UNKNOWN'],entryEvidence:{quote:{price:'101',at:now}}}}]:[]}});
   return route.fulfill({json:{asOf:now,validUntil:future,items:mode==='empty'?[]:[{id,listingId:'listing',type:'BREAKOUT_CONFIRMED',session:'2026-10-26',pivot:'100',lastLow:'95.05',close:'101',rvol:{numerator:'150',denominator:'100'},dataRevision:'revision-1',observedAt:now}]}});
  });
  await page.goto('/buy');await page.getByText('BREAKOUT_CONFIRMED',{exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/PLAN_NOT_EVALUATED/);
  await page.getByLabel('Estimated fees',{exact:true}).fill('1.25');await page.getByRole('button',{name:'Revalidate plan',exact:true}).click();await page.getByText('BUY_BLOCKED',{exact:true}).waitFor();assert.deepEqual(writes,[{marketEventId:id,snapshotId,estimatedFees:'1.25'}]);assert.match(await page.locator('main').innerText(),/G06_UNKNOWN/);
  mode='expired';await page.getByRole('button',{name:'Refresh BUY evidence',exact:true}).click();await page.getByText(/STALE \/ requires revalidation/).waitFor();assert.equal(await page.getByText('BUY_ELIGIBLE',{exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:'Record an actual manually executed BUY'}).getAttribute('href'),'/positions');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.runtime/buy-signals-mobile.png',fullPage:true});
  for(const status of ['403','503']){mode=status;await page.getByRole('button',{name:'Refresh BUY evidence',exact:true}).click();await page.locator('main').getByRole('alert').waitFor();assert.match(await page.locator('main').getByRole('alert').innerText(),new RegExp(status));assert.equal(await page.getByRole('article').count(),0)}
  mode='empty';await page.getByRole('button',{name:'Retry BUY evidence',exact:true}).click();await page.getByRole('heading',{name:'No recorded breakout events',exact:true}).waitFor();assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close()}
});
