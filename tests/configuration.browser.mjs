import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('configuration form saves network settings and fits mobile screens',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL,context=await browser.newContext({baseURL:base});
 try{
  assert.equal((await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}})).status(),201);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let network=null,revision='none';
  await page.route('**/api/v1/configuration**',async route=>{if(route.request().method()==='PUT'){assert.equal(route.request().headers()['if-match'],revision);assert.ok(route.request().headers()['x-csrf-token']);network=route.request().postDataJSON();revision='saved';return route.fulfill({json:{revision,network}})}return route.fulfill({json:{revision,network,source:network?'DATABASE':'NOT_CONFIGURED',runtime:{transportAllowed:true,configurationKeyReady:true,sessionKeyReady:true,liveEnabled:false},suggestedNetwork:{clientLocalIp:'127.0.0.1',macAddress:'00:11:22:33:44:55'}}})});
  await page.goto('/configuration');await page.getByRole('heading',{name:'Configuration',exact:true}).waitFor();
  await page.getByLabel('Server public IPv4').fill('192.0.2.1');await page.getByLabel('Verification reference',{exact:true}).fill('Synthetic browser verification');
  const local=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
  await page.getByLabel('Verified at (your local time)').fill(local(Date.now()-3600000));await page.getByLabel('Verification expires (your local time)').fill(local(Date.now()+3600000));await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Save network settings',exact:true}).click();await page.getByText('Network settings saved. Reconnect Angel One below to use these settings.',{exact:true}).waitFor();assert.equal(network.ipProof.address,'192.0.2.1');
  await page.reload();assert.equal(await page.getByLabel('Server public IPv4').inputValue(),'192.0.2.1');await page.screenshot({path:'.runtime/configuration-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.runtime/configuration-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close()}
});
