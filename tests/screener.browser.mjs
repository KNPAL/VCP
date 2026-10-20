// Browser-only synthetic responses; no synthetic financial data is written to a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('screener pins pages, renders evidence and failure states, and saves research filters',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.VCP_BROWSER_CHANNEL?{channel:process.env.VCP_BROWSER_CHANNEL}:{})});
 const base=process.env.WEB_TEST_BASE_URL??'http://localhost:3002';
 const context=await browser.newContext({baseURL:base});
 try{
  const password=process.env.WEB_TEST_PASSWORD??(await readFile('.runtime/owner-password','utf8')).trim();
  const login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN??'owner',password}});assert.equal(login.status(),201);
  const auth=await login.json(),page=await context.newPage();const failures=[];page.on('pageerror',e=>failures.push(e.message));
  const scanId='00000000-0000-4000-8000-000000000001',listing='00000000-0000-4000-8000-000000000002',listId='00000000-0000-4000-8000-000000000003';
  let mode='normal',latestCalls=0;const queries=[],writes=[];
  const summary={scanId,asOf:'2026-01-01T12:00:00Z',dataRevision:'synthetic-browser-revision',configHash:'a'.repeat(64),status:'PARTIAL',counts:{intended:30,analyzed:28,missing:2,excluded:0,rejected:1}};
  const row={instrumentId:listing,rank:1,marketState:'WATCH',rsPercentile:null,finalDepth:'5.12345678',vdu:'0.7',pivot:'100.050000',reasons:['RS_UNKNOWN'],patternEvidence:{primaryPatternId:'p1',patterns:[{id:'p1',atr:'2.12345678',distance:'1.050000',legs:[{high:{price:'100'},low:{price:'95'},depth:'5'}]}]}};
  await page.route('**/api/v1/vcp/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('latest-scan')){latestCalls++;if(mode==='loading')await new Promise(r=>setTimeout(r,500));return route.fulfill({json:mode==='unknown'?{scanId:null,status:'UNKNOWN'}:summary})}
   queries.push(url.searchParams);
   if(['403','503'].includes(mode))return route.fulfill({status:Number(mode),json:{}});
   const next=url.searchParams.has('cursor');return route.fulfill({json:{...summary,items:mode==='empty'?[]:[{...row,rank:next?26:1}],nextCursor:next||mode==='empty'?null:'stable-page-2'}});
  });
  await page.route('**/api/v1/watchlists**',async route=>{
   const request=route.request();if(request.method()==='POST'){writes.push({url:request.url(),body:request.postDataJSON(),csrf:request.headers()['x-csrf-token']});return route.fulfill({status:201,json:{id:listId,changed:true}})}
   return route.fulfill({json:request.url().endsWith('/instruments')?{items:[{listingId:listing,symbol:'SYNTH',exchange:'NSE'}]}:{items:[{id:listId,name:'Synthetic research',filters:{query:'',exchange:'ALL',state:'WATCH'}}]}});
  });
  await page.goto('/screener');await page.getByRole('heading',{name:'PARTIAL scan'}).waitFor();
  assert.match(await page.locator('main').innerText(),/STALE/);assert.match(await page.locator('main').innerText(),/raw scan age: \d+ seconds/);assert.match(await page.locator('main').innerText(),/Intended 30.*Failed \/ missing 2/);
  assert.match(await page.getByRole('table').innerText(),/2.12345678/);assert.match(await page.getByRole('table').innerText(),/RS_UNKNOWN/);assert.match(await page.getByRole('table').innerText(),/UNKNOWN/);
  await page.getByRole('button',{name:'Next page',exact:true}).click();await page.getByText('#26 · SYNTH',{exact:true}).waitFor();assert.equal(latestCalls,1);assert.equal(queries.at(-1).get('scanId'),scanId);assert.equal(queries.at(-1).get('cursor'),'stable-page-2');
  await page.getByRole('button',{name:'Previous page',exact:true}).click();await page.getByText('#1 · SYNTH',{exact:true}).waitFor();
  await page.getByLabel('Market state',{exact:true}).selectOption('READY');await page.getByRole('heading',{name:'PARTIAL scan'}).waitFor();assert.equal(queries.at(-1).get('state'),'READY');assert.equal(queries.at(-1).has('cursor'),false);assert.equal(latestCalls,1);
  await page.getByLabel('Research watchlist',{exact:true}).selectOption(listId);await page.getByRole('button',{name:'Apply saved state filter'}).click();await page.getByRole('heading',{name:'PARTIAL scan'}).waitFor();assert.equal(queries.at(-1).get('state'),'WATCH');
  await page.getByLabel('Save current state filter as watchlist').fill('Saved browser filter');await page.getByRole('button',{name:'Save filter',exact:true}).click();await page.getByText('Saved to your research watchlist. Scan evidence is unchanged.').waitFor();assert.equal(writes[0].body.filters.state,'WATCH');assert.equal(writes[0].csrf,auth.csrfToken);
  await page.getByRole('button',{name:'Save #1',exact:true}).click();await page.getByText('Saved to your research watchlist. Scan evidence is unchanged.').waitFor();assert.equal(writes[1].body.listingId,listing);
  for(const code of ['403','503']){mode=code;await page.getByRole('button',{name:'Refresh to latest scan'}).click();await page.locator('main').getByRole('alert').waitFor();assert.match(await page.locator('main').getByRole('alert').innerText(),new RegExp(code));assert.equal(await page.getByRole('table').count(),0)}
  mode='empty';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('heading',{name:'No candidates match this filter'}).waitFor();
  mode='unknown';await page.getByRole('button',{name:'Refresh to latest scan'}).click();await page.getByRole('heading',{name:'UNKNOWN — No completed scan'}).waitFor();
  mode='loading';await page.getByRole('button',{name:'Refresh to latest scan'}).click();await page.getByText('Loading scan evidence…',{exact:true}).waitFor();await page.getByRole('heading',{name:'PARTIAL scan'}).waitFor();
  await page.screenshot({path:'.runtime/screener-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:'.runtime/screener-mobile.png',fullPage:true});
  await page.getByRole('region',{name:'Scroll ranked candidates horizontally'}).focus();assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('role')),'region');await page.keyboard.press('Tab');
  assert.deepEqual(failures,[]);
  await context.request.post('/api/v1/auth/logout',{headers:{origin:base,'x-csrf-token':auth.csrfToken}});
 }finally{await context.close();await browser.close()}
});
