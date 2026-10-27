import {createHash} from 'node:crypto';
import type {Server as HttpServer} from 'node:http';
import {Server} from 'socket.io';
import {Queue} from 'bullmq';
import {ownerStreamBinding,materializeStreamTimeline,readStreamTimeline,permittedStreamListings,type PrismaClient} from '@vcp/database';
import {readQuoteCache,assessHeldQuote,canonicalListings,type CalendarDay,type InstrumentSnapshot} from '@vcp/market-data';
import {AuthService,type AuthRequest} from './auth.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function attachStream(server:HttpServer,db:PrismaClient,auth:AuthService){
 const io=new Server(server,{path:'/api/v1/socket.io',serveClient:false,transports:['websocket'],maxHttpBufferSize:8192,connectTimeout:10000,pingInterval:5000,pingTimeout:5000,allowRequest:(request,done)=>done(null,request.headers.origin===auth.origin)});
 const namespace=io.of('/stream');let queue:Queue|null=null,materializing:Promise<unknown>|null=null;
 io.use((_socket,next)=>next(new Error('STREAM_NAMESPACE_REQUIRED')));
 const synchronize=()=>{if(!materializing)materializing=materializeStreamTimeline(db).finally(()=>{materializing=null});return materializing};
 namespace.use((socket,next)=>{
  void (async()=>{
   if(socket.handshake.headers.origin!==auth.origin)throw new Error();
   const input=socket.handshake.auth as Record<string,unknown>,listings=input['listings']??[];
   if(!Array.isArray(listings)||listings.some(id=>typeof id!=='string')||Object.keys(input).some(k=>!['csrfToken','listings','cursor'].includes(k))||input['cursor']!==undefined&&typeof input['cursor']!=='string')throw new Error();
   const request:AuthRequest={method:'GET',path:'/stream',headers:{...socket.handshake.headers,'x-csrf-token':typeof input['csrfToken']==='string'?input['csrfToken']:''}};
   await auth.authenticate(request,true);await permittedStreamListings(db,listings);
   if([...namespace.sockets.values()].filter(s=>s.data['ownerId']===request.ownerId).length>=10)throw new Error();
   socket.data['request']=request;socket.data['ownerId']=request.ownerId;socket.data['listings']=listings;socket.data['cursor']=input['cursor'];
   next();
  })().catch(()=>next(new Error('STREAM_AUTH_OR_SCOPE_REJECTED')));
 });
 namespace.on('connection',socket=>{
  let busy=false,closed=false;const quoteIds=new Map<string,string>();
  const poll=async()=>{
   if(busy||closed)return;busy=true;
   try{
    const request=socket.data['request'] as AuthRequest;await auth.authenticate(request);
    const listings=await permittedStreamListings(db,socket.data['listings'] as string[]);
    await synchronize();if(closed)return;
    const cursor=socket.data['cursor'] as string|undefined;
    const page=await readStreamTimeline(db,request.ownerId!,{listings,...(cursor?{cursor}:{}),limit:100});
    await auth.authenticate(request);
    if(closed)return;
    for(const event of page.items)socket.emit(event.type,{...event,durable:true});
    socket.data['cursor']=page.cursor;socket.emit('stream.cursor',{cursor:page.cursor,hasMore:page.hasMore,replayUrl:'/api/v1/stream/events'});
    if(page.hasMore)setTimeout(()=>void poll(),0);
    if(!listings.length)return;
    const mappingRows=await db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=clock_timestamp() ORDER BY "knownAt" DESC,"id" LIMIT 1`;
    const calendarRows=await db.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "createdAt"<=clock_timestamp() ORDER BY "createdAt" DESC,"id" LIMIT 1`;
    const mapping=mappingRows[0]?.evidence??null,routing=await ownerStreamBinding(db,request.ownerId!,process.env['VCP_STREAM_ACCOUNT_KEY'],process.env['VCP_STREAM_OWNER']),owner=routing.name;
    for(const listingId of listings){
     if(closed)return;
     const at=new Date().toISOString(),listing=canonicalListings(mapping?[mapping]:[],mapping?.rows.map(r=>r.isin)??[],at).find(r=>r.primary?.listingId===listingId)?.primary;
     let quote:Awaited<ReturnType<typeof readQuoteCache>>={state:'UNKNOWN',reason:'STREAM_OWNER_UNCONFIGURED'};
     if(owner){
      if(!queue){queue=new Queue('api-stream-quotes',{connection:{host:process.env['REDIS_HOST']??'127.0.0.1',port:Number(process.env['REDIS_PORT']??6379),maxRetriesPerRequest:1,connectTimeout:1000,enableOfflineQueue:false,retryStrategy:attempt=>attempt<=2?100:null}});queue.on('error',()=>{})}
      let deadline:ReturnType<typeof setTimeout>|undefined;
      try{const work=async()=>{const client=await queue!.client;return readQuoteCache(async(script,keys)=>{const name='read_quote_'+hash(script).slice(0,16);client.defineCommand(name,{numberOfKeys:keys.length,lua:script});return client.runCommand(name,keys)},owner,listingId)};quote=await Promise.race([work(),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new Error('QUOTE_STORE_UNAVAILABLE')),1500)})])}catch{quote={state:'UNKNOWN',reason:'QUOTE_STORE_UNAVAILABLE'}}finally{clearTimeout(deadline)}
     }
     const assessment=assessHeldQuote(listing?.isin??'',new Date().toISOString(),calendarRows[0]?.evidence??null,mapping,quote);
     await auth.authenticate(request);
     const fresh=assessment.state==='FEED_FRESH'&&quote.state==='KNOWN',type=fresh?'quote.updated':'data.stale',value=fresh&&quote.state==='KNOWN'?quote.quote:null;
     const id=hash([listingId,type,value?.mappingRevision??mapping?.id,value?.sourceAt,value?.sequence,assessment.reason]);
     if(id===quoteIds.get(listingId))continue;quoteIds.set(listingId,id);
     socket.emit(type,{id,sequence:null,type,eventAt:new Date().toISOString(),sourceAt:value?.sourceAt??null,revision:value?.mappingRevision??mapping?.id??'UNKNOWN',correlationId:id,listingId,quote:value,reason:assessment.reason,validUntil:assessment.validUntil,durable:false,executable:false});
    }
   }catch{socket.emit('stream.error',{code:'STREAM_UNAVAILABLE',replayUrl:'/api/v1/stream/events'});socket.disconnect(true)}finally{busy=false}
  };
  const timer=setInterval(()=>void poll(),2000);void poll();
  socket.on('disconnect',()=>{closed=true;clearInterval(timer)});
  // Subscription changes require a new authenticated handshake and a fresh scope-bound REST cursor.
 });
 return async()=>{await new Promise<void>(resolve=>io.close(()=>resolve()));await materializing;await queue?.close()};
}
