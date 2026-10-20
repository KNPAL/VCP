import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('valuation expires independently of polling and keeps actual holdings visible',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const password=(await readFile('.runtime/owner-password','utf8')).trim(),login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:'owner',password}});assert.equal(login.status(),201);const auth=await login.json(),page=await context.newPage();
  const asOf=new Date().toISOString(),validUntil=new Date(Date.now()+5000).toISOString(),isin='INE000000001';
  await page.route('**/api/v1/portfolio',route=>route.fulfill({json:{cash:'1000.000000',asOf,equity:'2100.000000',realizedPnl:'0.000000',positions:[{isin,quantity:10,costBasis:'1000.000000',realizedPnl:'0.000000'}],lots:[],events:[],reversed:[],risk:{asOf,validUntil,reasons:[],valuation:{state:'KNOWN',equity:'2100.000000',grossExposure:'1100.000000',plannedOpenRisk:'150.000000',companyExposure:{[isin]:'1100.000000'},sectorExposure:{TECH:'1100.000000'}},plan:{state:'BUY_BLOCKED',reasons:['ENTRY_PLAN_REQUIRED']}}}}));
  await page.goto('/positions');const panel=page.getByRole('region',{name:'Portfolio valuation'});
  await panel.getByText('₹ 150.000000',{exact:true}).waitFor();
  await panel.locator('summary').click();await panel.getByText('ENTRY PLAN REQUIRED',{exact:true}).waitFor();
  await panel.getByText('Current valuation evidence unavailable or expired. Recorded holdings are retained.',{exact:true}).waitFor({timeout:10000});
  assert.match(await page.getByRole('region',{name:'Position feed monitoring'}).innerText(),/10 shares/);
  assert.equal(await panel.getByText('₹ 150.000000',{exact:true}).count(),0);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await context.request.post('/api/v1/auth/logout',{headers:{origin:base,'x-csrf-token':auth.csrfToken}});
 }finally{await context.close();await browser.close()}
});
