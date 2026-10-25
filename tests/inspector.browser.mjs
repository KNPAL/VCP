import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectorFixture} from '../fixtures/inspector.mjs';
import {inspectorSeries} from '../packages/database/dist/index.js';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('inspector renders stored annotations and accessible mobile charts without inventing fills',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}});assert.equal(login.status(),201);const auth=await login.json();
  const execution=inspectorFixture(),bars=inspectorSeries(execution),fixture={id:execution.id,asOf:new Date().toISOString(),sourceAt:execution.input.series.asOf,dataRevision:'synthetic-inspector',adjustmentRevision:'fixture',configHash:execution.input.configHash,listing:{symbol:'SYNTH',isin:'INE000000001',exchange:'NSE'},bars,structure:execution.detector.structure,frozen:execution.detector.frozen,breakout:execution.breakout,marketEvents:[],fills:[{id:'fill',session:bars.at(-1).session,side:'BUY',price:'96.7',quantity:2,occurredAt:bars.at(-1).finalizedAt,recordedAt:bars.at(-1).finalizedAt}],stops:[{id:'stop',closedAt:null,recordedAt:bars.at(-1).finalizedAt,overlayAllowed:false,stop:{activeStop:'90',effectiveAt:bars.at(-1).finalizedAt}}],trails:[]};
  let mode='normal';const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/vcp/inspector**',async route=>{
   if(['403','503'].includes(mode))return route.fulfill({status:Number(mode),json:{}});
   const detail=new URL(route.request().url()).pathname.endsWith(execution.id);
   if(!detail){if(mode==='loading')await new Promise(r=>setTimeout(r,500));return route.fulfill({json:{items:mode==='unknown'?[]:[{id:execution.id,listingId:execution.input.listingId,session:bars.at(-1).session,asOf:fixture.sourceAt}]}})}
   const data=structuredClone(fixture);if(mode==='empty'){data.bars=[];data.structure.swings=[];data.structure.patterns=[];data.structure.primary=null;data.frozen.primary=null;data.fills=[]}
   return route.fulfill({json:data});
  });
  await page.route('**/api/v1/watchlists/instruments',route=>route.fulfill({json:{items:[{listingId:execution.input.listingId,symbol:'SYNTH',exchange:'NSE'}]}}));
  await page.goto('/inspector');await page.getByRole('button',{name:'Fit chart',exact:true}).waitFor();await page.locator('.inspector-chart canvas').first().waitFor();const main=page.locator('main');
  assert.match(await main.innerText(),/STALE/);assert.match(await main.innerText(),/raw source age: \d+ seconds/);assert.match(await main.innerText(),/Actual BUY.*2 shares at raw price 96.7/);assert.match(await main.innerText(),/Different or unknown price basis/);assert.match(await main.innerText(),/100.000000/);assert.equal(await page.getByText('Chart unavailable — use the accessible evidence tables below.',{exact:true}).count(),0);
  await page.getByText('Daily candles and indicator values',{exact:true}).click();assert.match(await page.getByRole('region',{name:'Daily price and indicator evidence',exact:true}).innerText(),/UNKNOWN/);await page.getByText('Daily candles and indicator values',{exact:true}).click();
  await page.getByRole('button',{name:'Zoom in',exact:true}).focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Zoom out');await page.keyboard.press('Enter');await page.getByRole('button',{name:'Fit chart',exact:true}).click();
  await page.screenshot({path:'.runtime/inspector-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.runtime/inspector-mobile.png',fullPage:true});
  await page.getByRole('region',{name:'Confirmed swings',exact:true}).focus();assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('role')),'region');
  for(const code of ['403','503']){mode=code;await page.getByRole('button',{name:'Refresh executions',exact:true}).click();await main.getByRole('alert').waitFor();assert.match(await main.getByRole('alert').innerText(),new RegExp(code));assert.equal(await page.locator('.inspector-chart').count(),0)}
  mode='unknown';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('heading',{name:'UNKNOWN — No stored daily executions',exact:true}).waitFor();
  mode='empty';await page.getByRole('button',{name:'Refresh executions',exact:true}).click();await page.getByRole('heading',{name:'Empty — no candles in this execution',exact:true}).waitFor();
  mode='loading';await page.getByRole('button',{name:'Refresh executions',exact:true}).click();await page.getByText('Loading inspector evidence…',{exact:true}).waitFor();await page.getByRole('button',{name:'Fit chart',exact:true}).waitFor();assert.deepEqual(errors,[]);
  await context.request.post('/api/v1/auth/logout',{headers:{origin:base,'x-csrf-token':auth.csrfToken}});
 }finally{await context.close();await browser.close()}
});
