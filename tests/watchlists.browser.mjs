import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('watchlists distinguish access/service errors and preserve research filters without scanner changes',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),base=process.env.WEB_TEST_BASE_URL,context=await browser.newContext({baseURL:base});
 try{
  assert.equal((await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}})).status(),201);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let mode=403,list=null;const instrument={listingId:'fixture',symbol:'SYNTHETIC',isin:'INE000000001',exchange:'NSE'},at=new Date().toISOString();
  await page.route('**/api/v1/watchlists**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(request.method()==='GET'){if(mode!==200)return route.fulfill({status:mode,json:{}});return route.fulfill({json:{items:path.endsWith('/instruments')?[instrument]:list?[list]:[]}})}
   assert.ok(request.headers()['x-csrf-token']);const body=request.postDataJSON();
   if(path.endsWith('/watchlists'))list={id:'list',name:body.name,filters:body.filters,updatedAt:at,items:list?.items??[]};
   else if(request.method()==='POST'){assert.deepEqual(body,{listingId:instrument.listingId});if(!list.items.length)list.items.push({...instrument,savedAt:at,reason:'VERIFIED_SCAN_REQUIRED'})}
   else{assert.equal(request.method(),'DELETE');list.items=[]}
   return route.fulfill({json:{id:'list'}});
  });
  await page.goto('/watchlists');await page.getByRole('alert').filter({hasText:'403 — Access denied'}).waitFor();mode=503;await page.getByRole('button',{name:'Retry watchlists',exact:true}).click();await page.getByRole('alert').filter({hasText:'503 — Watchlist service unavailable'}).waitFor();mode=200;await page.getByRole('button',{name:'Retry watchlists',exact:true}).click();await page.getByText('No saved watchlists yet.',{exact:true}).waitFor();
  await page.getByLabel('Watchlist name',{exact:true}).fill('Research list');await page.getByRole('button',{name:'Save watchlist',exact:true}).click();await page.getByRole('heading',{name:'Research list',exact:true}).waitFor();await page.getByLabel('Verified canonical instrument',{exact:true}).selectOption('fixture');await page.getByRole('button',{name:'Add to watchlist',exact:true}).click();await page.getByRole('button',{name:'Remove SYNTHETIC',exact:true}).waitFor();await page.getByRole('button',{name:'Add to watchlist',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Remove SYNTHETIC',exact:true}).count(),1);
  await page.getByLabel('Filter by symbol or ISIN',{exact:true}).fill('SYN');await page.getByLabel('Exchange',{exact:true}).selectOption('NSE');await page.getByRole('button',{name:'Save filters',exact:true}).click();await page.getByText('Saved. Scanner state is unchanged.',{exact:true}).waitFor();await page.getByLabel('Choose watchlist',{exact:true}).selectOption('');await page.getByLabel('Choose watchlist',{exact:true}).selectOption('list');assert.equal(await page.getByLabel('Filter by symbol or ISIN',{exact:true}).inputValue(),'SYN');assert.equal(await page.getByLabel('Exchange',{exact:true}).inputValue(),'NSE');await page.getByRole('cell',{name:/^Unknown/}).waitFor();assert.match(await page.locator('main').innerText(),/raw source age/);
  await page.getByRole('button',{name:'Remove SYNTHETIC',exact:true}).focus();await page.keyboard.press('Enter');await page.getByText('No saved instruments match these filters.',{exact:true}).waitFor();await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.runtime/watchlists-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close()}
});
