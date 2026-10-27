import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {PrismaClient,appendPortfolio,materializeStreamTimeline,readStreamTimeline,persistInstrumentSnapshot,saveBrokerConfiguration,installBrokerSession,logoutBroker} from '../packages/database/dist/index.js';
import {brokerAccountKey} from '../packages/market-data/dist/index.js';
import {createApp} from '../apps/api/dist/app.js';
const {io}=createRequire(new URL('../apps/api/package.json',import.meta.url))('socket.io-client');
const hash=value=>createHash('sha256').update(value).digest('hex'),db=new PrismaClient();
const until=(socket,event,predicate=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(event,listener);reject(new Error('Timed out: '+event))},10000);const listener=value=>{if(!predicate(value))return;clearTimeout(timer);socket.off(event,listener);resolve(value)};socket.on(event,listener)});
test('authenticated stream rejects foreign scope, replays immutable missed events and disconnects revoked sessions',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 let app,socket,owner,funded=false;const sockets=[],token=randomBytes(32).toString('hex'),csrf=hash('csrf:'+token),origin='http://localhost:39002';
 try{
  owner=await db.owner.findFirstOrThrow();await db.session.create({data:{id:hash(token),ownerId:owner.id,csrfHash:hash(csrf),expiresAt:new Date(Date.now()+3600000)}});
  for(let round=0;round<30;round++)if(await materializeStreamTimeline(db)===0)break;
  let page=await readStreamTimeline(db,owner.id,{limit:200});while(page.hasMore)page=await readStreamTimeline(db,owner.id,{cursor:page.cursor,limit:200});const baseline=page.cursor;
  const tail=await readStreamTimeline(db,owner.id,{limit:3,tail:true});assert.ok(tail.items.length<=3);assert.equal(tail.hasMore,false);assert.equal((await readStreamTimeline(db,owner.id,{cursor:tail.cursor})).items.length,0);await assert.rejects(readStreamTimeline(db,owner.id,{cursor:tail.cursor,tail:true}),/INVALID_STREAM_CURSOR/);
  assert.ok(!(await readStreamTimeline(db,randomUUID(),{limit:200})).items.some(item=>item.reference.table==='PortfolioJournal'));
  await assert.rejects(readStreamTimeline(db,randomUUID(),{cursor:baseline}),/INVALID_STREAM_CURSOR/);
  await assert.rejects(readStreamTimeline(db,owner.id,{listings:[randomUUID()]}),/STREAM_LISTING_FORBIDDEN/);
  app=await createApp({db,origin,secure:false,logSink:()=>{}});await app.listen(0,'127.0.0.1');const base='http://127.0.0.1:'+app.getHttpServer().address().port;
  assert.equal((await fetch(base+'/api/v1/stream/events')).status,401);
  const replay=async cursor=>{const response=await fetch(base+'/api/v1/stream/events?cursor='+encodeURIComponent(cursor),{headers:{cookie:'vcp_session='+token}});assert.equal(response.status,200);return response.json()};
  const client=(auth={csrfToken:csrf,cursor:baseline},headers={Origin:origin,Cookie:'vcp_session='+token})=>{const s=io(base+'/stream',{path:'/api/v1/socket.io',transports:['websocket'],autoConnect:false,reconnection:false,auth,extraHeaders:headers});sockets.push(s);return s};
  for(const [auth,headers] of [[{csrfToken:'wrong'},{Origin:origin,Cookie:'vcp_session='+token}],[{csrfToken:csrf},{Origin:'https://other.example',Cookie:'vcp_session='+token}],[{csrfToken:csrf},{Origin:origin}],[{csrfToken:csrf,listings:[randomUUID()]},{Origin:origin,Cookie:'vcp_session='+token}]]){
   const bad=client(auth,headers),failure=until(bad,'connect_error');bad.connect();await failure;bad.close();
  }
  socket=client();const connected=until(socket,'connect');socket.connect();await connected;
  const firstCursor=until(socket,'stream.cursor');await firstCursor;
  const sourceId='stream-'+randomUUID(),event=until(socket,'position.changed',e=>e.reference?.table==='PortfolioJournal');
  const command={kind:'DEPOSIT',amount:'1',verified:true,occurredAt:new Date().toISOString(),sourceId};
  await appendPortfolio(db,owner.id,sourceId,command);funded=true;
  const delivered=await event;assert.equal(delivered.durable,true);assert.equal(delivered.executable,false);assert.match(delivered.sequence,/^\d+$/);assert.ok(Number.isFinite(Date.parse(delivered.eventAt)));
  const recovered=await replay(baseline);assert.ok(recovered.items.some(item=>item.id===delivered.id));
  const repeated=await replay(baseline);assert.deepEqual(repeated.items.map(item=>item.id),recovered.items.map(item=>item.id));
  await assert.rejects(db.$executeRaw`UPDATE "StreamTimeline" SET "revision"='changed' WHERE "id"=${delivered.id}`);
  socket.close();
  await appendPortfolio(db,owner.id,sourceId+'-close',{...command,kind:'WITHDRAWAL',occurredAt:new Date().toISOString(),sourceId:sourceId+'-close'});funded=false;
  const afterDisconnect=await replay(recovered.cursor);assert.ok(afterDisconnect.items.some(item=>item.type==='position.changed'));
  socket=client({csrfToken:csrf,cursor:recovered.cursor});const replayed=until(socket,'position.changed',e=>afterDisconnect.items.some(item=>item.id===e.id));socket.connect();await replayed;
  const disconnected=until(socket,'disconnect');await db.session.delete({where:{id:hash(token)}});await disconnected;
  assert.equal((await fetch(base+'/api/v1/stream/events',{headers:{cookie:'vcp_session='+token}})).status,401);
 }finally{
  for(const s of sockets)s.close();
  if(funded&&owner)await appendPortfolio(db,owner.id,randomUUID(),{kind:'WITHDRAWAL',amount:'1',verified:true,occurredAt:new Date().toISOString(),sourceId:randomUUID()});
  await db.session.deleteMany({where:{id:hash(token)}});
  if(app)await app.close();else await db.$disconnect();
 }
});

test('socket quotes stay transient, deduplicate ticks and emit stale after cache expiry',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 const {queue,acquireStreamLease,releaseLease}=await import('../apps/worker/dist/runtime.js'),{recordQuoteConnection,publishLiveTick}=await import('../apps/worker/dist/live-quotes.js');
 const previous={owner:process.env.VCP_STREAM_OWNER,account:process.env.VCP_STREAM_ACCOUNT_KEY,port:process.env.REDIS_PORT};
 const clientCode='T'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),accountKey=brokerAccountKey(clientCode),streamOwner='smartapi-'+accountKey;process.env.VCP_STREAM_OWNER=streamOwner;delete process.env.VCP_STREAM_ACCOUNT_KEY;process.env.REDIS_PORT='56379';
 const q=queue(streamOwner),token=randomBytes(32).toString('hex'),csrf=hash('csrf:'+token),origin='http://localhost:39002',listingId=randomUUID(),isin='INE'+String(Math.floor(Math.random()*1e9)).padStart(9,'0');let app,socket,fence;
 try{
  const owner=await db.owner.findFirstOrThrow();await db.session.create({data:{id:hash(token),ownerId:owner.id,csrfHash:hash(csrf),expiresAt:new Date(Date.now()+3600000)}});
  const before=new Date(Date.now()-10000).toISOString(),date=new Date(Date.now()+19800000).toISOString().slice(0,10),session={date,opensAt:new Date(date+'T00:00:00+05:30').toISOString(),closesAt:new Date(date+'T23:59:59+05:30').toISOString(),knownAt:before,verified:true};
  const mapping=await persistInstrumentSnapshot(db,{knownAt:new Date().toISOString(),sourceReference:'synthetic-stream-browser',rows:[{companyId:randomUUID(),listingId,isin,exchange:'NSE',series:'EQ',symbol:'TEST',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]});
  await db.$executeRaw`INSERT INTO "CalendarSnapshot" ("id","evidence") VALUES (${hash(randomUUID())},${JSON.stringify([{...session,kind:'SPECIAL',finalizedAt:null,source:'synthetic-stream-browser'}])}::jsonb)`;
  const sessionKey=randomBytes(32);await saveBrokerConfiguration(db,owner.id,{apiKey:'synthetic-stream-key',clientCode},randomUUID(),sessionKey);await new Promise(r=>setTimeout(r,5));await installBrokerSession(db,{reference:randomUUID(),accountKey,sessionRevision:randomUUID(),keyId:'stream-test',expiresAt:session.closesAt},{accessToken:'synthetic-access',apiKey:'synthetic-stream-key',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'},{authenticated:true,staticIpVerified:true,verifiedAt:new Date().toISOString()},async()=>sessionKey);sessionKey.fill(0);
  fence=await acquireStreamLease(q,streamOwner);assert.ok(fence);await recordQuoteConnection(q,streamOwner,fence,'CONNECTED');
  app=await createApp({db,origin,secure:false,logSink:()=>{}});await app.listen(0,'127.0.0.1');const base='http://127.0.0.1:'+app.getHttpServer().address().port;
  socket=io(base+'/stream',{path:'/api/v1/socket.io',transports:['websocket'],autoConnect:false,reconnection:false,auth:{csrfToken:csrf,listings:[listingId]},extraHeaders:{Origin:origin,Cookie:'vcp_session='+token}});
  let quotes=0;socket.on('quote.updated',()=>quotes++);const received=until(socket,'quote.updated');socket.connect();
  const tick={provider:'fixture',token:'123',exchange:'NSE',rawLtp:'10005',priceDecimals:2,sourceAt:new Date().toISOString(),sequence:'1'};
  assert.equal((await publishLiveTick(q,streamOwner,fence,tick,mapping,session)).state,'KNOWN');const quote=await received;assert.equal(quote.quote.ltp,'100.050000');assert.equal(quote.durable,false);assert.equal(quote.executable,false);assert.ok(Date.parse(quote.validUntil)>Date.now());
  assert.equal((await publishLiveTick(q,streamOwner,fence,tick,mapping,session)).state,'UNKNOWN');await new Promise(r=>setTimeout(r,2200));assert.equal(quotes,1);
  const stale=until(socket,'data.stale',e=>e.durable===false);const client=await q.client;await client.del('quotes:'+streamOwner+':'+listingId);assert.equal((await stale).quote,null);
  const refreshed=until(socket,'quote.updated');await publishLiveTick(q,streamOwner,fence,{...tick,sourceAt:new Date().toISOString(),sequence:'2'},mapping,session);await refreshed;
  const revoked=until(socket,'data.stale',e=>e.durable===false);await logoutBroker(db,owner.id);assert.equal((await revoked).quote,null);
  assert.equal((await db.$queryRaw`SELECT COUNT(*)::int AS count FROM "StreamTimeline" WHERE "kind"='quote.updated'`)[0].count,0);
 }finally{
  socket?.close();if(fence)await releaseLease(q,streamOwner,fence);const client=await q.client;await client.del('lease:'+streamOwner,'fence:'+streamOwner,'quotes:'+streamOwner+':connection','quotes:'+streamOwner+':'+listingId,'quotes:'+streamOwner+':'+listingId+':watermark');await q.close();
  await db.session.deleteMany({where:{id:hash(token)}});if(app)await app.close();else await db.$disconnect();
  for(const [key,value] of Object.entries({VCP_STREAM_OWNER:previous.owner,VCP_STREAM_ACCOUNT_KEY:previous.account,REDIS_PORT:previous.port})){if(value===undefined)delete process.env[key];else process.env[key]=value}
 }
});
