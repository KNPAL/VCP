import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('first login guides connected users to data setup and empty research screens have next steps',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),context=await browser.newContext({baseURL:process.env.WEB_TEST_BASE_URL});
 try{
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/broker/angel-one/status',route=>route.fulfill({json:{sessionState:'CONNECTED',canFetchHistory:false,canStreamLive:false,tokenExpiresAt:new Date(Date.now()+3600000).toISOString(),validUntil:new Date(Date.now()+3600000).toISOString(),staticIpStatus:'VERIFIED'}}));
  await page.goto('/login');await page.getByLabel('Login',{exact:true}).fill(process.env.WEB_TEST_LOGIN);await page.getByLabel('Password',{exact:true}).fill(process.env.WEB_TEST_PASSWORD);await page.getByRole('button',{name:'Sign in to workspace',exact:false}).click();await page.waitForURL('**/start');await page.getByRole('heading',{name:'Broker connected',exact:true}).waitFor();await page.getByRole('heading',{name:'Stock setup needs attention',exact:true}).waitFor();
  await page.screenshot({path:'.runtime/start-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.runtime/start-mobile.png',fullPage:true});
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Download stocks',exact:true}).click();await page.getByRole('heading',{name:'Download setup required',exact:true}).waitFor();assert.equal(await page.getByLabel('Stock selection',{exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'Reconnect Angel One',exact:true}).count(),0);
  await page.goto('/inspector');await page.getByRole('heading',{name:'No charts to inspect yet',exact:true}).waitFor();assert.equal(await page.getByLabel('Stored execution',{exact:true}).count(),0);await page.getByRole('link',{name:'Check setup and next step',exact:true}).click();await page.waitForURL('**/start');
  await page.goto('/backtests');await page.getByRole('heading',{name:'No backtest results yet',exact:true}).waitFor();assert.equal(await page.getByRole('combobox').count(),0);
  await page.goto('/screener');await page.getByRole('heading',{name:'No scan results yet',exact:true}).waitFor();assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close()}
});
