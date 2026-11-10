import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('data setup exposes a guarded initializer, download links, excluded entries and visible controls',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),context=await browser.newContext({baseURL:process.env.WEB_TEST_BASE_URL});
 try{const page=await context.newPage();let submitted=null;
 await page.route('**/api/v1/data/setup',route=>route.fulfill({json:{holidayCount:231,calendarSnapshots:1,excluded:['TEST: unsupported series; excluded']}}));
 await page.route('**/api/v1/history/downloads/choices',route=>route.fulfill({json:{memberCount:1,state:'KNOWN',items:[{enabled:true,finalizedThrough:'2026-11-09'}]}}));
 await page.route('**/api/v1/data/initialize',async route=>{submitted=route.request().postDataJSON();assert.ok(route.request().headers()['x-csrf-token']);await route.fulfill({json:{stockCount:495,message:'Initialization complete.'}})});
 await page.goto('/login');await page.getByLabel('Login',{exact:true}).fill(process.env.WEB_TEST_LOGIN);await page.getByLabel('Password',{exact:true}).fill(process.env.WEB_TEST_PASSWORD);await page.getByRole('button',{name:'Sign in to workspace',exact:false}).click();await page.waitForURL('**/start');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Data setup & downloads',exact:true}).click();await page.getByRole('heading',{name:'Data setup & downloads',exact:true}).waitFor();
 const action=page.getByRole('button',{name:'Refresh market data',exact:true});assert.equal(await action.isDisabled(),true);await page.getByRole('checkbox').check();assert.equal(await action.isEnabled(),true);await action.click();await page.getByText('495 stocks imported. Initialization complete.',{exact:true}).waitFor();assert.deepEqual(submitted,{confirmed:true});await page.getByText('TEST: unsupported series; excluded',{exact:true}).waitFor();
 const styles=await page.locator('a.primary').first().evaluate(a=>({background:getComputedStyle(a).backgroundColor,color:getComputedStyle(a).color}));assert.notEqual(styles.background,styles.color);assert.notEqual(styles.background,'rgba(0, 0, 0, 0)');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.getByRole('link',{name:'Open stock downloads',exact:true}).getAttribute('href'),'/data/historical/download');
 }finally{await context.close();await browser.close()}
});
