import type {Queue} from 'bullmq';
import {decodeSmartApiLtp,planStreamSubscriptions,streamSubscriptionDelta,smartApiSubscriptionMessage,type InstrumentSnapshot,type QuoteSession,type StreamCandidate,type StreamSubscription} from '@vcp/market-data';
import {acquireStreamLease,renewLease,releaseLease} from './runtime.js';
import {publishLiveTick,recordQuoteConnection} from './live-quotes.js';

export interface StreamContext {mapping:InstrumentSnapshot|null;session:QuoteSession|null;holdings:string[];candidates:StreamCandidate[];credentialRevision:string;credentialExpiresAt:string}
export interface StreamSocket {send:(message:string)=>void;close:()=>void}
export interface StreamCallbacks {frame:(data:Uint8Array)=>void;pong:()=>void;lost:()=>void}
export interface StreamOwnerDependencies {
 context:()=>Promise<StreamContext>;
 // Adapter must bound connection time, verify TLS, and never reconnect independently.
 connect:(context:StreamContext,callbacks:StreamCallbacks,signal:AbortSignal)=>Promise<StreamSocket>;
 now?:()=>number;
}
/** One serialized coordinator. Every new connection acquires a new fence; callbacks retain their original fence. */
export class StreamOwner {
 private fence:string|null=null;
 private socket:StreamSocket|null=null;
 private context:StreamContext|null=null;
 private desired:StreamSubscription[]=[];
 private generation=0;
 private lastPong=0;
 private retryAt=0;
 private failures=0;
 private stopped=false;
 private active:Promise<void>|null=null;
 private pendingFrames=0;
 private frames:Promise<void>=Promise.resolve();
 private controller:AbortController|null=null;
 constructor(private q:Queue,private owner:string,private provider:string,private capacity:number,private deps:StreamOwnerDependencies){
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(owner)||!provider||!Number.isSafeInteger(capacity)||capacity<1||capacity>1000)throw new Error('INVALID_STREAM_CONFIGURATION');
 }
 private now(){return (this.deps.now??Date.now)()}
 cycle(){if(this.stopped)return Promise.resolve();if(this.active)return this.active;this.active=this.run().finally(()=>{this.active=null});return this.active}
 private async disconnect(retry:boolean){
  ++this.generation;this.controller?.abort();this.controller=null;
  const socket=this.socket,fence=this.fence;this.socket=null;this.fence=null;this.context=null;this.desired=[];
  try{socket?.close()}catch{/* Closing is best effort; fence invalidates its callbacks. */}
  if(retry){this.failures=Math.min(this.failures+1,6);this.retryAt=this.now()+Math.min(60000,1000*2**(this.failures-1))}
  if(fence){try{await recordQuoteConnection(this.q,this.owner,fence,'DISCONNECTED')}finally{await releaseLease(this.q,this.owner,fence)}}
 }
 private receive(data:Uint8Array,generation:number,fence:string){
  if(generation!==this.generation||!this.socket||this.stopped)return;
  if(this.pendingFrames>=1000){void this.disconnect(true).catch(()=>{});return}
  const receivedAt=new Date(this.now()).toISOString(),tick=decodeSmartApiLtp(data,this.provider);
  if(!tick||!this.desired.some(s=>s.token===tick.token&&s.exchange===tick.exchange))return;
  this.pendingFrames++;
  this.frames=this.frames.then(async()=>{
   if(generation!==this.generation||this.fence!==fence||!this.context||this.stopped)return;
   if(!this.desired.some(s=>s.token===tick.token&&s.exchange===tick.exchange))return;
   await publishLiveTick(this.q,this.owner,fence,tick,this.context.mapping,this.context.session,receivedAt);
  }).catch(()=>{if(generation===this.generation)void this.disconnect(true).catch(()=>{})}).finally(()=>{this.pendingFrames--});
 }
 private async run(){
  if(this.now()<this.retryAt)return;
  try{
   const context=await this.deps.context();if(this.stopped)return;
   const now=this.now(),session=context.session;
   if(!session?.verified||![session.knownAt,session.opensAt,session.closesAt,context.credentialExpiresAt].every(value=>Number.isFinite(Date.parse(value)))||Date.parse(session.knownAt)>now||Date.parse(session.opensAt)>now||Date.parse(session.closesAt)<=now||Date.parse(context.credentialExpiresAt)<=now){await this.disconnect(false);return}
   const plan=planStreamSubscriptions({holdings:context.holdings,candidates:context.candidates,mapping:context.mapping,provider:this.provider,asOf:new Date(now).toISOString(),capacity:this.capacity});
   if(!plan.subscriptions.length){await this.disconnect(false);return}
   if(this.socket&&(this.context?.credentialRevision!==context.credentialRevision||this.context.session?.date!==session.date)){await this.disconnect(false)}
   if(this.socket&&this.now()-this.lastPong>=20000){await this.disconnect(true);return}
   if(!this.fence){
    this.fence=await acquireStreamLease(this.q,this.owner,15000);if(!this.fence)return;
    if(this.stopped){await this.disconnect(false);return}
    const fence=this.fence,generation=++this.generation;this.controller=new AbortController();
    const socket=await this.deps.connect(context,{frame:data=>this.receive(data,generation,fence),pong:()=>{if(generation===this.generation)this.lastPong=this.now()},lost:()=>{if(generation===this.generation)void this.disconnect(true).catch(()=>{})}},this.controller.signal);
    if(this.stopped||generation!==this.generation){socket.close();return}
    this.socket=socket;this.lastPong=this.now();
   }
   const fence=this.fence;if(!fence||!this.socket)return;
   if(!await renewLease(this.q,this.owner,fence,15000)){await this.disconnect(true);return}
   if(!await recordQuoteConnection(this.q,this.owner,fence,'CONNECTED')){await this.disconnect(true);return}
   this.context=context;
   const delta=streamSubscriptionDelta(this.desired,plan.subscriptions);
   if(delta.remove.length)this.socket.send(JSON.stringify(smartApiSubscriptionMessage(0,delta.remove,'remove')));
   if(delta.add.length)this.socket.send(JSON.stringify(smartApiSubscriptionMessage(1,delta.add,'subscribe')));
   this.desired=plan.subscriptions;
   this.socket.send('ping');
   // Only a sustained healthy connection resets retry backoff.
   if(this.failures&&this.now()>this.retryAt+60000)this.failures=0;
  }catch{await this.disconnect(true).catch(()=>{})}
 }
 async stop(){this.stopped=true;await this.disconnect(false);await this.active;await this.frames}
 async drained(){await this.frames}
}
