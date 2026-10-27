'use client';
import {useEffect,useState} from 'react';
import {io,type Socket} from 'socket.io-client';
type Event={id:string;type:string;eventAt:string;durable?:boolean;validUntil?:string;executable:false;reference?:{table:string}};
const labels:Record<string,string>={'position.changed':'Position updated','stop.changed':'Stop evidence updated','signal.created':'Signal recorded','decision.updated':'Decision updated','alert.created':'Alert recorded','scan.completed':'Scan completed','pattern.changed':'Pattern updated','data.stale':'Data unavailable','quote.updated':'Quote updated'};
export default function LiveUpdates(){
 const [state,setState]=useState('Connecting'),[events,setEvents]=useState<Event[]>([]);
 useEffect(()=>{
  let stopped=false,socket:Socket|null=null,timer:ReturnType<typeof setTimeout>|undefined,cursor:string|undefined,scope='',running=false;
  const seen=new Set<string>(),controller=new AbortController();
  const accept=(event:Event)=>{if(stopped||!event||typeof event.id!=='string'||!labels[event.type]||event.executable!==false||seen.has(event.id))return;if(event.type==='quote.updated'&&event.validUntil&&Date.parse(event.validUntil)>Date.now())window.dispatchEvent(new CustomEvent('vcp:stream-delivery',{detail:true}));if(event.type==='data.stale')window.dispatchEvent(new CustomEvent('vcp:stream-delivery',{detail:false}));seen.add(event.id);if(seen.size>2000)seen.delete(seen.values().next().value!);setEvents(items=>[event,...items].slice(0,5));window.dispatchEvent(new CustomEvent('vcp:stream-event',{detail:event}))};
  const get=async(path:string)=>{const response=await fetch(path,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('UPDATES_UNAVAILABLE');return response.json()};
  const retry=()=>{if(stopped)return;window.dispatchEvent(new CustomEvent('vcp:stream-delivery',{detail:false}));setState('Paused');clearTimeout(timer);timer=setTimeout(()=>void connect(),5000)};
  const connect=async()=>{
   if(running||stopped)return;running=true;
   socket?.removeAllListeners();socket?.close();socket=null;
   try{
    setState('Syncing');
    const [session,positions,instruments]=await Promise.all([get('/api/v1/auth/session'),get('/api/v1/positions'),get('/api/v1/watchlists/instruments')]);
    const holdings=new Set((positions.items as {isin:string}[]).map(item=>item.isin)),listings=(instruments.items as {isin:string;listingId:string}[]).filter(item=>holdings.has(item.isin)).map(item=>item.listingId).sort().slice(0,100);
    const nextScope=JSON.stringify([session.owner.id,listings]);if(nextScope!==scope){scope=nextScope;cursor=undefined;seen.clear()}
    // REST restores durable history first. Socket delivery then continues from that exact scope-bound cursor.
    for(let page=0;page<50;page++){
     const query=new URLSearchParams({listings:listings.join(','),limit:'200',...(cursor?{cursor}:{tail:'1'})}),result=await get('/api/v1/stream/events?'+query);
     for(const event of result.items)accept(event);cursor=result.cursor;if(!result.hasMore)break;
    }
    if(stopped)return;
    socket=io('/stream',{path:'/api/v1/socket.io',transports:['websocket'],autoConnect:false,reconnection:false,auth:{csrfToken:session.csrfToken,listings,cursor}});
    socket.on('connect',()=>{setState('Connected');window.dispatchEvent(new CustomEvent('vcp:stream-delivery',{detail:true}))});
    socket.onAny((type,event)=>{if(labels[type])accept(event);if(type==='position.changed'&&event.reference?.table==='PortfolioJournal'){socket?.close();retry()}});
    socket.on('stream.cursor',event=>{cursor=event.cursor;setState(event.hasMore?'Syncing':'Connected')});
    socket.on('disconnect',()=>{window.dispatchEvent(new CustomEvent('vcp:stream-delivery',{detail:false}));retry()});socket.on('connect_error',()=>{window.dispatchEvent(new CustomEvent('vcp:stream-delivery',{detail:false}));socket?.close();retry()});socket.connect();
   }catch{retry()}finally{running=false}
  };
  void connect();
  return()=>{stopped=true;controller.abort();clearTimeout(timer);socket?.removeAllListeners();socket?.close()};
 },[]);
 return <details className="liveupdates"><summary aria-label={'Event updates '+state}>Updates: {state.toLowerCase()}</summary><div><p>Event delivery status. Market-data freshness is shown separately. Signals never execute trades.</p>{events.length?<ul>{events.map(event=><li key={event.id}>{labels[event.type]} <time dateTime={event.eventAt}>{new Date(event.eventAt).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})} IST</time></li>)}</ul>:<p>No event updates received.</p>}</div></details>;
}
