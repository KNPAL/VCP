import test from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VCP_PLAYWRIGHT_MODULE??'playwright');
test('browser channel requires an explicit grant and stores the preference across navigation',async()=>{
 const base=process.env.WEB_TEST_BASE_URL;
 const browser=await chromium.launch({headless:true,channel:process.env.VCP_BROWSER_CHANNEL??'msedge'});
 const context=await browser.newContext({baseURL:base});
 try{
  await context.addInitScript(()=>{
   window.requestCount=0;
   Object.defineProperty(window,'Notification',{value:class {
    static permission='default';
    static async requestPermission(){window.requestCount++;return this.permission}
   }});
  });
  const login=await context.request.post('/api/v1/auth/login',{headers:{origin:base},data:{login:process.env.WEB_TEST_LOGIN,password:process.env.WEB_TEST_PASSWORD}});
  assert.equal(login.status(),201);
  const page=await context.newPage();await page.goto('/alerts');
  const enable=page.getByRole('button',{name:'Enable browser notifications'});
  await enable.waitFor();assert.equal(await page.evaluate(()=>window.requestCount),0);
  await enable.click();await page.getByRole('alert').filter({hasText:'require permission'}).waitFor();
  assert.equal((await (await context.request.get('/api/v1/alerts/inbox')).json()).preferences.browserEnabled,false);
  await page.evaluate(()=>{Notification.permission='granted'});
  await enable.click();await page.getByRole('button',{name:'Disable browser notifications'}).waitFor();
  await page.reload();await page.getByRole('button',{name:'Disable browser notifications'}).click();await enable.waitFor();
 }finally{await context.close();await browser.close()}
});
