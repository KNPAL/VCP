import test from 'node:test';
import assert from 'node:assert/strict';
import {smeResearch} from '../packages/market-data/dist/index.js';
import {smeEvidence} from '../fixtures/sme-research.mjs';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('SME research exposes restrictions, hides expired/denied facts and never permits a BUY',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  assert.equal((await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}})).status(),201);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let mode='normal';const source=smeEvidence(new Date().toISOString()),input={asOf:source.knownAt,liquidity:'100000.000000',liquiditySourceAt:source.knownAt,actionRevision:'action-revision',actionSourceAt:source.knownAt};
  await page.route('**/api/v1/research/sme**',async route=>{
   assert.equal(route.request().method(),'GET');if(['403','503'].includes(mode))return route.fulfill({status:Number(mode),json:{}});if(mode==='loading')await new Promise(r=>setTimeout(r,500));
   if(new URL(route.request().url()).pathname.endsWith('/sme'))return route.fulfill({json:{items:mode==='empty'?[]:[{listingId:source.listingId,isin:source.isin}]}});
   const evidence=mode==='denied'?{...source,source:{...source.source,uses:{...source.source.uses,DISPLAY:false}}}:mode==='restricted'?{...source,restrictions:{...source.restrictions,asm:true}}:mode==='unknown'?{...source,lot:null,lotVerified:false}:source;
   const result=smeResearch(evidence,input);return route.fulfill({json:{...result,validUntil:mode==='stale'?'2020-01-01T00:00:00Z':result.validUntil,metadataRevision:'metadata-revision',calendarRevision:'calendar-revision'}});
  });
  await page.goto('/research/sme');await page.getByRole('heading',{name:'RESEARCH_OBSERVATION',exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/BUY_BLOCKED/);assert.match(await page.locator('main').innerText(),/NSE SME/);assert.match(await page.locator('main').innerText(),/100000.000000/);assert.match(await page.locator('main').innerText(),/raw source age: \d+ seconds/);assert.equal(await page.getByRole('button',{name:/buy/i}).count(),0);
  await page.getByText('Research source revisions',{exact:true}).focus();await page.keyboard.press('Enter');await page.getByText('Metadata: metadata-revision',{exact:false}).waitFor();await page.screenshot({path:'.runtime/sme-research-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.runtime/sme-research-mobile.png',fullPage:true});
  mode='restricted';await page.getByRole('button',{name:'Refresh SME research',exact:true}).click();await page.getByRole('heading',{name:'RESTRICTED',exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/ASM YES/);mode='unknown';await page.getByRole('button',{name:'Refresh SME research',exact:true}).click();await page.getByRole('heading',{name:'UNKNOWN',exact:true}).waitFor();assert.equal(await page.getByText('100',{exact:true}).count(),0);
  mode='denied';await page.getByRole('button',{name:'Refresh SME research',exact:true}).click();await page.getByText('SME_SOURCE_UNAVAILABLE_OR_NOT_PERMITTED',{exact:true}).waitFor();assert.equal(await page.getByText('100000.000000',{exact:true}).count(),0);
  mode='stale';await page.getByRole('button',{name:'Refresh SME research',exact:true}).click();await page.getByText('STALE — source or surveillance proof expired. Refresh before reviewing current restrictions.',{exact:true}).waitFor();assert.equal(await page.getByText('100000.000000',{exact:true}).count(),0);
  for(const code of ['403','503']){mode=code;await page.getByRole('button',{name:'Refresh SME research',exact:true}).click();await page.locator('main').getByRole('alert').waitFor();assert.match(await page.locator('main').getByRole('alert').innerText(),new RegExp(code));assert.equal(await page.getByRole('heading',{name:'RESEARCH_OBSERVATION',exact:true}).count(),0)}
  mode='empty';await page.getByRole('button',{name:'Retry SME research',exact:true}).click();await page.getByRole('heading',{name:'No reviewed SME listings',exact:true}).waitFor();mode='loading';await page.getByRole('button',{name:'Refresh SME research',exact:true}).click();await page.getByText('Loading SME evidence…',{exact:true}).waitFor();await page.getByRole('heading',{name:'RESEARCH_OBSERVATION',exact:true}).waitFor();assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close()}
});
