import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('empty installation explains download setup and past jobs never submit a download',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL,context=await browser.newContext({baseURL:base});
 try{
  assert.equal((await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}})).status(),201);
  const page=await context.newPage();let submissions=0;
  await page.route('**/api/v1/history/downloads/choices',route=>route.fulfill({json:{state:'UNKNOWN',memberCount:0,items:[],setup:{executionEnabled:false,signingKeyReady:false,instrumentMappingReady:false}}}));
  await page.route('**/api/v1/history/downloads',route=>{if(route.request().method()==='POST')submissions++;return route.fulfill({json:{items:[],nextCursor:null}})});
  await page.goto('/universe');await page.getByRole('link',{name:'Set up historical download',exact:true}).click();await page.getByRole('heading',{name:'Download setup required',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Stock selection',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Preview stored coverage',exact:true}).count(),0);
  await page.getByText(/NIFTY 500 membership is missing or unverified/).waitFor();await page.getByText(/The download service is disabled/).waitFor();await page.getByText(/The download signing key is unavailable/).waitFor();
  await page.getByRole('link',{name:'View past downloads',exact:true}).click();await page.waitForURL('**/data/historical/downloads');assert.equal(submissions,0);
 }finally{await context.close();await browser.close()}
});
