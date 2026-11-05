import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
const choices = {state:'KNOWN',memberCount:1,items:[{listingId:'synthetic',isin:'INE000000001',symbol:'SYNTHETIC',exchange:'NSE',enabled:true,finalizedThrough:'2025-01-03'}]};
test('download preview handles expiry, changed input, permission errors and keyboard/mobile without submission',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}});assert.equal(login.status(),201,login.status()===404?(await login.text()).slice(0,180):'Login failed');
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let mode='normal',calls=0;
  await page.route('**/api/v1/watchlists', route=>route.fulfill({json:{items:[{id:'saved',name:'Research',items:[{listingId:'synthetic'}]}]}}));
  await page.route('**/api/v1/history/downloads/**',async route=>{if(route.request().url().endsWith('/choices'))return route.fulfill({json:choices});assert.ok(route.request().url().endsWith('/preview'));assert.equal(route.request().method(),'POST');assert.ok(route.request().headers()['x-csrf-token']);assert.deepEqual(route.request().postDataJSON().listingIds,['synthetic']);calls++;if(mode==='403'||mode==='503')return route.fulfill({status:Number(mode),json:{error:{message:'Preview unavailable'}}});if(mode==='loading')await new Promise(r=>setTimeout(r,500));const now=new Date().toISOString();return route.fulfill({json:{previewId:'preview-revision',checkedAt:now,expiresAt:mode==='expired'?'2020-01-01T00:00:00Z':new Date(Date.now()+300000).toISOString(),dataRevision:'data-revision',universeSnapshotId:'universe-revision',instrumentSnapshotId:'instrument-revision',sourceSnapshotId:'source-revision',eligibleCount:mode==='empty'?0:1,alreadyStoredCount:2,missingCount:mode==='empty'?null:mode==='current'?0:1,planWindowCount:mode==='current'?0:1,warnings:['BROKER_HISTORY_UNAVAILABLE_LOCAL_PREVIEW_ONLY'],quotaNote:'Estimated requests only',blockedInstruments:[],items:mode==='empty'?[]:[{listingId:'synthetic',symbol:'SYNTHETIC',state:'KNOWN',missingCount:1,alreadyStoredCount:2,reasons:[],rangesToFetch:[{from:'2025-01-02',to:'2025-01-02',sessions:['2025-01-02']}],excludedDates:[]}]}})});
  await page.route('**/api/v1/broker/angel-one/status',route=>route.fulfill({json:{sessionState:'CONNECTED',canFetchHistory:true,canStreamLive:false,tokenExpiresAt:new Date(Date.now()+60000).toISOString(),validUntil:new Date(Date.now()+60000).toISOString()}}));
  await page.goto('/data/historical/download');const selection=page.getByLabel('Stock selection',{exact:true});
  await selection.selectOption('CUSTOM');
  assert.equal(await page.getByRole('button',{name:'Preview stored coverage'}).isDisabled(),true);
  await page.getByRole('checkbox',{name:/SYNTHETIC/}).check();
  assert.equal(await page.getByLabel('From exchange date',{exact:true}).inputValue(),'2023-01-03');
  await selection.selectOption('saved');
  await page.getByLabel('Date range',{exact:true}).selectOption('5');await page.getByLabel('Through exchange date',{exact:true}).fill('2024-02-29');assert.equal(await page.getByLabel('From exchange date',{exact:true}).inputValue(),'2019-02-28');await page.getByLabel('From exchange date',{exact:true}).fill('2025-01-01');await page.getByLabel('Through exchange date',{exact:true}).fill('2025-01-03');const submit=page.getByRole('button',{name:'Preview stored coverage',exact:true});await submit.click();await page.getByRole('heading',{name:'Coverage preview',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Start download'}).isDisabled(),true);
  await page.locator('summary').filter({hasText:'SYNTHETIC'}).focus();await page.keyboard.press('Enter');await page.getByText(/1 sessions to fetch/).waitFor();await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.runtime/download-preview-mobile.png',fullPage:true});
  mode='current';await submit.click();await page.getByText(/Already up to date/).waitFor();
  assert.ok(await page.getByRole('button',{name:'Start download',exact:true}).isDisabled());
  await page.getByLabel('Download mode',{exact:true}).selectOption('RECONCILE');assert.equal(await page.getByRole('heading',{name:'Coverage preview',exact:true}).count(),0);mode='expired';await submit.click();await page.getByText('EXPIRED — refresh the preview before using these findings.',{exact:true}).waitFor();
  for(const code of ['403','503']){mode=code;await submit.click();await page.getByText(code+' — Preview unavailable',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Coverage preview',exact:true}).count(),0)}
  mode='empty';await submit.click();await page.getByText('No eligible local coverage evidence.',{exact:true}).waitFor();mode='loading';const before=calls;await submit.click();await page.getByText('Checking your request…',{exact:true}).waitFor();assert.equal(await submit.isDisabled(),true);await page.getByRole('heading',{name:'Coverage preview',exact:true}).waitFor();assert.equal(calls,before+1);assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close()}
});
test('signed preview submits once and job controls retain retry keys after response loss',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}});assert.equal(login.status(),201);
  const page=await context.newPage(),keys=[],runId='11111111-1111-4111-8111-111111111111';let state='QUEUED',submissions=0,cancels=0;
  const request={universeId:'NIFTY_500',interval:'1d',mode:'MISSING_ONLY',fromDate:'2025-01-01',toDate:'2025-01-03'};
  await page.route('**/api/v1/history/downloads**',async route=>{
   const req=route.request(),url=new URL(req.url()),now=new Date().toISOString();
   if(url.pathname.endsWith('/choices'))return route.fulfill({json:choices});
   if(url.pathname.endsWith('/preview'))return route.fulfill({json:{previewId:'signed-token',previewFingerprint:'public-fingerprint',submissionEnabled:true,checkedAt:now,expiresAt:new Date(Date.now()+300000).toISOString(),dataRevision:'data',eligibleCount:1,alreadyStoredCount:2,missingCount:1,planWindowCount:1,warnings:[],quotaNote:'Shared quota applies',blockedInstruments:[],items:[]}});
   if(req.method()==='POST'){
    assert.ok(req.headers()['x-csrf-token']);assert.ok(req.headers()['idempotency-key']);
    if(url.pathname.endsWith('/cancel')){cancels++;state='CANCELLED';return route.fulfill({json:{runId,status:state}})}
    keys.push(req.headers()['idempotency-key']);submissions++;assert.deepEqual(req.postDataJSON(),{previewId:'signed-token',mode:'MISSING_ONLY'});
    if(submissions===1)return route.fulfill({status:503,json:{error:{message:'Temporary response failure'}}});
    await new Promise(r=>setTimeout(r,300));return route.fulfill({status:202,json:{runId,status:state}});
   }
   const item={runId,status:state,createdAt:now,request};
   return route.fulfill({json:url.pathname.endsWith('/'+runId)?{...item,retryEnabled:true,windowCounts:[],candleChanges:{newCandles:'0',revisedCandles:'0',unchangedCandles:'0'},events:[{id:'event',state,createdAt:now,evidence:{reason:'USER_SUBMISSION_ACCEPTED'}}]}:{items:[item],nextCursor:null}});
  });
  await page.route('**/api/v1/broker/angel-one/status',route=>route.fulfill({json:{sessionState:'CONNECTED',canFetchHistory:true,canStreamLive:false,tokenExpiresAt:new Date(Date.now()+60000).toISOString(),validUntil:new Date(Date.now()+60000).toISOString()}}));
  await page.goto('/data/historical/download');await page.getByLabel('Date range',{exact:true}).selectOption('5');await page.getByLabel('Through exchange date',{exact:true}).fill('2024-02-29');assert.equal(await page.getByLabel('From exchange date',{exact:true}).inputValue(),'2019-02-28');await page.getByLabel('From exchange date',{exact:true}).fill('2025-01-01');await page.getByLabel('Through exchange date',{exact:true}).fill('2025-01-03');await page.getByRole('button',{name:'Preview stored coverage',exact:true}).click();const submit=page.getByRole('button',{name:'Start download',exact:true});await submit.click();await page.getByText('503 — Temporary response failure',{exact:true}).waitFor();await submit.evaluate(button=>{button.click();button.click()});assert.equal(await submit.isDisabled(),true);await page.waitForURL('**/downloads/'+runId);assert.equal(submissions,2);assert.equal(keys[0],keys[1]);
  await page.getByRole('heading',{name:'QUEUED',exact:true}).waitFor();await page.getByRole('button',{name:'Cancel download',exact:true}).click();assert.equal(cancels,0);await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();await page.getByRole('heading',{name:'CANCELLED',exact:true}).waitFor();assert.equal(cancels,1);assert.equal(await page.getByRole('button',{name:'Cancel download',exact:true}).count(),0);
  await page.getByRole('link',{name:'All download jobs',exact:true}).click();await page.getByRole('heading',{name:'Recent requests'}).waitFor();await page.getByRole('link',{name:'CANCELLED · 2025-01-01 – 2025-01-03',exact:true}).waitFor();await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }finally{await context.close();await browser.close()}
});
test('500-stock partial job survives offline and reload, shows quota and resumes after authentication',async()=>{
 const base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002';
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'});
 const context=await browser.newContext({baseURL:base});
 try{
  const login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}});
  assert.equal(login.status(),201);
  const page=await context.newPage(),runId='11111111-1111-4111-8111-111111111111',path='/api/v1/history/downloads/'+runId;
  const instruments=Array.from({length:500},(_,index)=>({symbol:'Stock '+index,listingId:String(index),coverageState:'KNOWN',storedCandles:index?3:2,expectedSessions:3,latestStoredSession:'2025-01-03',latestSuccessfulSession:null,remainingRequestRanges:index?[]:[{from:'2025-01-02',to:'2025-01-02',sessions:['2025-01-02']}]}));
  let state='PARTIAL',retry=0;
  await page.route('**'+path+'**',async route=>{
   const now=new Date().toISOString();
   if(route.request().method()==='POST'){
    assert.ok(route.request().headers()['idempotency-key']);
    retry++;
    if(state==='PAUSED_QUOTA')return route.fulfill({status:429,json:{error:{message:'Quota wait active'}}});
    state='QUEUED';return route.fulfill({json:{runId,status:state}});
   }
   return route.fulfill({json:{runId,status:state,retryEnabled:true,createdAt:now,request:{universeId:'NIFTY_500',mode:'MISSING_ONLY',interval:'1d',fromDate:'2025-01-01',toDate:'2025-01-03'},candleChanges:{newCandles:'2',revisedCandles:'0',unchangedCandles:'1'},windowCounts:[],events:[],progress:{checkedAt:now,instruments,attemptedWindows:499,failedWindows:1,retriedWindows:0,windows:[{id:'w',listingId:'0',state:'FAILED',reason:'RATE_LIMITED',currentGeneration:true}]}}});
  });
  await page.goto('/data/historical/downloads/'+runId);
  await page.getByText(/499 of 500/).waitFor();
  await page.getByText('Recorded window errors').click();
  await page.getByText('FAILED · RATE_LIMITED',{exact:true}).waitFor();
  await context.setOffline(true);await page.getByText(/Offline. Showing the last received/).waitFor();
  assert.ok(await page.getByRole('button',{name:'Retry remaining sessions'}).isDisabled());
  await context.setOffline(false);state='PAUSED_QUOTA';await page.reload();
  await page.getByRole('heading',{name:'PAUSED_QUOTA'}).waitFor();
  await page.getByRole('button',{name:'Retry remaining sessions'}).click();
  await page.getByText('429 — Quota wait active').waitFor();
  state='PAUSED_AUTH';await page.getByRole('button',{name:'Refresh download status'}).click();
  await page.getByRole('heading',{name:'PAUSED_AUTH'}).waitFor();
  await page.getByRole('link',{name:'Connect / Reauthenticate'}).waitFor();
  await page.getByRole('button',{name:'Retry remaining sessions'}).click();
  await page.getByRole('heading',{name:'QUEUED'}).waitFor();assert.equal(retry,2);
 }finally{await context.close();await browser.close()}
});
