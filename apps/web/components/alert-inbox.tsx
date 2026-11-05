'use client';
import {useCallback,useEffect,useState} from 'react';

const base='/api/v1/alerts';
async function post(path:string,body:object){
 const session=await fetch('/api/v1/auth/session',{cache:'no-store'});
 if(!session.ok)throw new Error('Sign in again to use alerts.');
 const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':(await session.json()).csrfToken},body:JSON.stringify(body)});
 if(!response.ok)throw new Error('Unable to save the alert update. Please retry.');
 return response.json();
}
export function BrowserAlerts({owner}:{owner:string}){
 useEffect(()=>{
  let stopped=false,busy=false;
  async function poll(){
   if(stopped||busy||!navigator.onLine||!('Notification' in window)||Notification.permission!=='granted')return;
   busy=true;
   try{
    const {delivery}=await post('/browser/next',{});
    if(stopped||!delivery)return;
    const key='vcp-browser-alert-'+owner;
    const recent:string[]=JSON.parse(localStorage.getItem(key)??'[]');
    let shown=recent.includes(delivery.id);
    if(!shown){
     try{
      new Notification('Study Trade · '+delivery.kind,{tag:delivery.id,body:'Open the alert inbox to review.'});
      shown=true;
      localStorage.setItem(key,JSON.stringify([...recent.slice(-99),delivery.id]));
     }catch{/* A denied browser alert stays visible in the in-app inbox. */}
    }
    await post('/browser/receipt',{id:delivery.id,token:delivery.token,shown});
   }catch{/* Retry after connectivity or the delivery lease recovers. */}finally{busy=false}
  }
  void poll();
  const timer=setInterval(poll,10000);
  window.addEventListener('online',poll);
  return ()=>{stopped=true;clearInterval(timer);window.removeEventListener('online',poll)};
 },[owner]);
 return null;
}
type Channel={channel:string;state:string;attempts:number;attemptedAt:string|null;deliveredAt:string|null};
type Item={id:string;kind:string;instrument:string|null;quantity:string|null;sourceAt:string|null;decidedAt:string;acknowledged:boolean;dismissed:boolean;channels:Channel[]};
type Inbox={items:Item[];preferences:{emailEnabled:boolean;browserEnabled:boolean};emailConfigured:boolean};
const time=(value:string|null)=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',timeZoneName:'short'}):'Unavailable';
export function AlertInbox(){
 const [data,setData]=useState<Inbox|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[dismissed,setDismissed]=useState(false);
 const refresh=useCallback(async()=>{
  const response=await fetch(base+'/inbox',{cache:'no-store'});
  if(!response.ok)throw new Error('Unable to load the inbox.');
  setData(await response.json());
 },[]);
 useEffect(()=>{const load=()=>void refresh().catch(error=>setMessage(error.message));load();const timer=setInterval(load,15000);return ()=>clearInterval(timer)},[refresh]);
 async function update(path:string,body:object){
  setBusy(true);setMessage('');
  try{await post(path,body);await refresh()}catch(error){setMessage((error as Error).message)}finally{setBusy(false)}
 }
 async function browserToggle(){
  const enabled=!data?.preferences.browserEnabled;
  if(enabled&&(!('Notification' in window)||await Notification.requestPermission()!=='granted')){
   setMessage('Browser notifications require permission in this browser.');return;
  }
  await update('/preferences',{channel:'BROWSER',enabled});
 }
 const visible=data?.items.filter(i=>dismissed||!i.dismissed);
 return <><h1>Alert inbox</h1><p>Review signals and monitoring interruptions. All trades require manual execution.</p>
 {message&&<p role="alert">{message}</p>}
 {data&&<section className="panel"><h2>Delivery preferences</h2>
 <button disabled={busy} onClick={()=>void browserToggle().catch(()=>setMessage('Browser permission is unavailable.'))}>{data.preferences.browserEnabled?'Disable':'Enable'} browser notifications</button>{' '}
 <button disabled={busy||(!data.emailConfigured&&!data.preferences.emailEnabled)} onClick={()=>void update('/preferences',{channel:'EMAIL',enabled:!data.preferences.emailEnabled})}>{data.preferences.emailEnabled?'Disable':'Enable'} email</button>
 {!data.emailConfigured&&<p>Email delivery requires a configured recipient.</p>}</section>}
 <label><input type="checkbox" checked={dismissed} onChange={e=>setDismissed(e.target.checked)}/> Show dismissed alerts</label>
 {!data?<p>Loading inbox…</p>:!visible?.length?<p>No alerts to review.</p>:visible.map(item=><article className="panel" key={item.id}>
 <h2>{item.kind} {item.instrument}</h2><p>Source time {time(item.sourceAt)} · Decision {time(item.decidedAt)} · Quantity {item.quantity??'Unavailable'}</p>
 <ul>{item.channels.map(ch=><li key={ch.channel}>{ch.channel} · {ch.state} · Attempts {ch.attempts} · Last attempted {time(ch.attemptedAt)} · {ch.channel==='EMAIL'?'Provider accepted':'Delivered'} {time(ch.deliveredAt)}</li>)}</ul>
 <button disabled={busy||item.acknowledged||item.dismissed} onClick={()=>void update('/inbox/'+item.id+'/review',{kind:'ACKNOWLEDGED'})}>{item.acknowledged?'Acknowledged':'Acknowledge'}</button>{' '}
 <button disabled={busy||item.dismissed} onClick={()=>void update('/inbox/'+item.id+'/review',{kind:'DISMISSED'})}>{item.dismissed?'Dismissed':'Dismiss'}</button></article>)}</>;
}
