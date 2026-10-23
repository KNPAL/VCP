import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('browser restores event timeline before connecting and shows reconnect state without implying fresh market data',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002',context=await browser.newContext({baseURL:base});
 try{
  const response=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}});assert.equal(response.status(),201);
  const page=await context.newPage();let replays=0;const failures=[],transport=[],replayResponses=[];page.on('request',request=>{if(request.url().includes('/api/v1/stream/events?'))replays++});page.on('response',async response=>{if(response.status()>=400)failures.push([new URL(response.url()).pathname,response.status()]);if(response.url().includes('/api/v1/stream/events?')){try{const value=await response.json();replayResponses.push({status:response.status(),count:value.items?.length,hasMore:value.hasMore})}catch{/* Response may be interrupted during offline testing. */}}});page.on('pageerror',error=>failures.push(error.message));page.on('websocket',ws=>{transport.push('opened');ws.on('socketerror',()=>transport.push('error'));ws.on('close',()=>transport.push('closed'));ws.on('framereceived',frame=>{const value=String(frame.payload);if(value.includes('STREAM_'))transport.push(value)})});
  await page.goto('/settings');try{await page.getByLabel('Event updates Connected',{exact:true}).waitFor({timeout:30000})}catch{assert.fail(JSON.stringify({state:await page.locator('.liveupdates').innerText(),replays,failures,replayResponses,transport}))}assert.ok(replays>0);
  await page.getByLabel('Event updates Connected',{exact:true}).click();assert.match(await page.locator('.liveupdates').innerText(),/Signals never execute trades/);
  await context.setOffline(true);await page.getByLabel('Event updates Paused',{exact:true}).waitFor({timeout:18000});const prior=replays;
  await context.setOffline(false);await page.getByLabel('Event updates Connected',{exact:true}).waitFor({timeout:30000});assert.ok(replays>prior);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }finally{await context.close();await browser.close()}
});

