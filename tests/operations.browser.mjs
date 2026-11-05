import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('operations recovers after a failed refresh and never displays a passing gate summary over missing evidence',async()=>{
 const base=process.env.WEB_TEST_BASE_URL,browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'}),context=await browser.newContext({baseURL:base});
 try{
  assert.equal((await context.request.get('/api/v1/data/operations')).status(),401);
  const res=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}});
  assert.equal(res.status(),201);
  const page=await context.newPage();
  await page.goto('/operations');await page.getByRole('heading',{name:'Readiness · BLOCKED'}).waitFor();
  await page.getByText(/G10 ·/).waitFor();
  await page.route('**/api/v1/data/operations',r=>r.fulfill({status:503,json:{}}));
  await page.getByRole('button',{name:'Refresh operations'}).press('Enter');
  await page.getByRole('alert').filter({hasText:'503'}).waitFor();
  assert.equal(await page.getByRole('heading',{name:/Readiness/}).count(),0);
  await page.unroute('**/api/v1/data/operations');await page.getByRole('button',{name:'Refresh operations'}).click();
  await page.getByRole('heading',{name:'Readiness · BLOCKED'}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'Readiness · BLOCKED'}).waitFor();
 }finally{await context.close();await browser.close()}
});
