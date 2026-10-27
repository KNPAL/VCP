import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('broker setup and reconnect clear secrets, handle failures and remain usable on mobile',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL,context=await browser.newContext({baseURL:base});
 try{
  const auth=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}});assert.equal(auth.status(),201);
  const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
  let state={configured:false,apiKeyMasked:null,clientCodeMasked:null,sessionState:'NOT_CONFIGURED',sessionAuthenticatedAt:null,tokenExpiresAt:null,canFetchHistory:false,canStreamLive:false,serverPublicIpDisplayOrNull:null,lastErrorCode:null},failure=null;
  await page.route('**/api/v1/broker/angel-one/**',async route=>{
   const req=route.request(),kind=new URL(req.url()).pathname.split('/').at(-1);if(kind==='status')return route.fulfill({json:state});
   writes.push({kind,body:req.postDataJSON()});assert.ok(req.headers()['x-csrf-token']);
   await new Promise(r=>setTimeout(r,250));
   if(failure){state={...state,sessionState:'NEEDS_LOGIN',canFetchHistory:false,lastErrorCode:failure};return route.fulfill({status:503,json:{error:{message:failure}}})}
   if(kind==='config'){assert.ok(req.headers()['idempotency-key']);state={...state,configured:true,apiKeyMasked:'••••',clientCodeMasked:'••••23',sessionState:'NEEDS_LOGIN'};return route.fulfill({json:{revision:'synthetic'}})}
   state={...state,sessionState:kind==='login'?'CONNECTED':'NEEDS_LOGIN',sessionAuthenticatedAt:new Date().toISOString(),tokenExpiresAt:new Date(Date.now()+3600000).toISOString(),canFetchHistory:kind==='login',lastErrorCode:null};return route.fulfill({status:201,json:state});
  });
  await page.goto('/settings/broker/angel-one');await page.getByText('NOT_CONFIGURED',{exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'Connect to Angel One',exact:true}).isDisabled());
  await page.getByLabel('API key',{exact:true}).fill('synthetic-browser-key');await page.getByRole('button',{name:'Show API key',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.getByLabel('API key',{exact:true}).getAttribute('type'),'text');await page.getByLabel('Client code',{exact:true}).fill('TEST123');await page.getByRole('button',{name:'Save broker details',exact:true}).click();await page.getByText('NEEDS_LOGIN',{exact:true}).waitFor();assert.equal(await page.getByLabel('API key',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Client code',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('API key',{exact:true}).getAttribute('type'),'password');
  const connect=page.getByRole('button',{name:'Connect to Angel One',exact:true}),pin=page.getByLabel('Angel One PIN',{exact:true}),totp=page.getByLabel('Authenticator code',{exact:true});await pin.fill('4926');await totp.fill('12');await connect.click();assert.equal(writes.length,1);assert.equal(await totp.evaluate(e=>e.validity.valid),false);
  await totp.fill('725419');await connect.click();await page.getByText('Updating broker connection…',{exact:true}).waitFor();assert.ok(await connect.isDisabled());await page.getByText('CONNECTED',{exact:true}).waitFor();assert.equal(await pin.inputValue(),'');assert.equal(await totp.inputValue(),'');assert.deepEqual(writes[1],{kind:'login',body:{pin:'4926',totp:'725419'}});await page.getByText('Unavailable — live readiness is not verified',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Disconnect broker',exact:true}).click();await page.getByText('NEEDS_LOGIN',{exact:true}).waitFor();failure='BAD_TOTP';await pin.fill('4926');await totp.fill('725419');await connect.click();await page.getByRole('alert').filter({hasText:'Enter the current six-digit code'}).waitFor();assert.equal(await pin.inputValue(),'');assert.equal(await totp.inputValue(),'');
  for(const code of ['BAD_CREDENTIALS','APP_CONFIG_INVALID','STATIC_IP_NOT_VERIFIED','PROVIDER_UNAVAILABLE','SESSION_EXPIRED']){failure=code;await pin.fill('4926');await totp.fill('725419');await connect.click();await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Refresh connection',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('fieldset')?.disabled);assert.equal(await pin.inputValue(),'');assert.equal(await totp.inputValue(),'')}
  failure=null;await pin.fill('4926');await totp.fill('725419');await connect.click();await page.getByText('CONNECTED',{exact:true}).waitFor();
  const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));for(const secret of ['synthetic-browser-key','4926','725419'])assert.ok(!storage.includes(secret));assert.ok(!page.url().includes('725419'));
  await page.screenshot({path:'.runtime/broker-connection-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.runtime/broker-connection-mobile.png',fullPage:true});
  state={...state,tokenExpiresAt:'2020-01-01T00:00:00Z'};await page.getByRole('button',{name:'Refresh connection',exact:true}).click();await page.getByText('EXPIRED',{exact:true}).waitFor();
  await pin.fill('4926');await page.getByRole('link',{name:'Historical downloads →',exact:true}).click();await page.goBack();await page.getByRole('heading',{name:'Connect Angel One',exact:true}).waitFor();assert.equal(await page.getByLabel('Angel One PIN',{exact:true}).inputValue(),'');assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close()}
});
