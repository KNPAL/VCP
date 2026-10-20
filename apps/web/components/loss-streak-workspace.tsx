'use client';
import {useEffect,useRef,useState} from 'react';
type CashEvent={id:string;kind:string;amount?:string;occurredAt:string};
type Evidence={allocationHistory?:{id:string;cashEventId:string;episodeId:string;reason:string;recordedAt:string}[];state:string;streak:number|null;asOf:string;reasons:string[];unallocatedCashEventIds:string[];cooldown:{session:string|null;resetAt:string|null}|null;episodes:{id:string;isin:string;closedAt:string|null;quantity:number;netPnl:string|null;cashEventIds:string[]}[]};
export default function LossStreakWorkspace({journalAsOf,cashEvents}:{journalAsOf:string;cashEvents:CashEvent[]}){
 const [data,setData]=useState<Evidence|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const pending=useRef<{body:string;key:string}|null>(null);
 async function load(){try{const response=await fetch('/api/v1/portfolio/loss-streak',{cache:'no-store'});if(!response.ok)throw new Error('Loss-streak evidence unavailable');setData(await response.json())}catch{setData(null)}}
 useEffect(()=>{void load()},[journalAsOf]);
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   const fields=new FormData(event.currentTarget),body=JSON.stringify({cashEventId:fields.get('cashEventId'),episodeId:fields.get('episodeId'),reason:fields.get('reason')});
   if(pending.current?.body!==body)pending.current={body,key:crypto.randomUUID()};
   const auth=await fetch('/api/v1/auth/session',{cache:'no-store'});if(!auth.ok)throw new Error('Sign in again to allocate cash');const session=await auth.json();
   const response=await fetch('/api/v1/portfolio/cash-allocations',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken,'idempotency-key':pending.current.key},body});
   if(!response.ok)throw new Error('Unable to save cash allocation ('+response.status+'). Check the event and position episode.');
   pending.current=null;setNotice('Allocation recorded. Cash and actual fills are unchanged.');await load();
  }catch(e){setError(e instanceof Error?e.message:'Allocation unavailable')}finally{setBusy(false)}
 }
 const costs=cashEvents.filter(e=>['FEE','DIVIDEND','CORPORATE_CREDIT','CORPORATE_DEBIT'].includes(e.kind));
 return <section className="panel journalforms" aria-label="Loss-streak protection"><h2>Loss-streak protection</h2><p role="status"><strong>{data?.state??'UNKNOWN'}</strong> · Consecutive fully closed losses: {data?.streak??'Unknown'}</p><p>Three net losses block new BUY plans and top-ups through the next completed exchange session. Actual holdings continue protective monitoring. A passing loss-streak check does not approve a BUY.</p>
 {data?.cooldown&&<p>Cooldown session: {data.cooldown.session??'Verified calendar required'} · Completion: {data.cooldown.resetAt??'Not finalized'}</p>}
 <p className="caption">{data?'Checked '+data.asOf:'Current evidence unavailable.'}{data?.reasons.length?' · '+data.reasons.join(', '):''}</p>
 {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {!!data?.episodes.length&&<div className="tablewrap"><table><thead><tr><th>Position episode</th><th>Actual state</th><th>Net P&amp;L</th></tr></thead><tbody>{data.episodes.map(e=><tr key={e.id}><td>{e.isin}<div className="caption">{e.id}</div></td><td>{e.closedAt?'Closed '+e.closedAt:'Open · '+e.quantity+' shares'}</td><td>{e.netPnl===null?'Unknown / not closed':'₹ '+e.netPnl}</td></tr>)}</tbody></table></div>}
 {!!costs.length&&<><h3>Attribute position cash</h3><p>Link fees, dividends or corporate-action cash to the position episode supported by your records. Unallocated cash blocks loss classification. A correction adds a new allocation version and retains the earlier audit record.</p><form onSubmit={event=>void submit(event)}><label className="field">Cash event<select aria-label="Cash event" name="cashEventId" required defaultValue=""><option value="" disabled>Select a recorded cash event</option>{costs.map(e=><option key={e.id} value={e.id}>{e.kind} · ₹ {e.amount} · {e.id}</option>)}</select></label><label className="field">Position episode<select aria-label="Position episode" name="episodeId" required defaultValue=""><option value="" disabled>Select the actual position episode</option>{data?.episodes.map(e=><option key={e.id} value={e.id}>{e.isin} · {e.id}</option>)}</select></label><label className="field">Allocation reason<input name="reason" required maxLength={1000}/></label><label className="checkfield"><input type="checkbox" required/> I checked this allocation against my account records.</label><button className="primary" disabled={busy||!data}>{busy?'Saving…':'Record cash allocation'}</button></form></>}
 {!!data?.allocationHistory?.length&&<details><summary>Cash allocation audit history</summary><ul className="allocationhistory">{data.allocationHistory.map(item=><li key={item.id}>{item.recordedAt} · {item.reason} · Cash {item.cashEventId} → Episode {item.episodeId}</li>)}</ul></details>}
 </section>;
}


