'use client';
import {useEffect,useRef,useState} from 'react';
type Evidence={state:string;reasons:string[];latest:{id:string;statement:{asOf:string;sourceReference:string};result:{quantities:{isin:string;journal:number;statement:number}[];missingInJournal:string[];missingInStatement:string[]}}|null;history:{id:string;statement:{asOf:string;sourceReference:string};result:{state:string}}[]};
export default function ReconciliationWorkspace({journalAsOf}:{journalAsOf:string}){
 const [data,setData]=useState<Evidence|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[asOf,setAsOf]=useState('');
 const pending=useRef<{body:string;key:string}|null>(null);
 async function load(){try{const response=await fetch('/api/v1/portfolio/reconciliation',{cache:'no-store'});if(!response.ok)throw new Error('Reconciliation evidence unavailable');setData(await response.json());setError('')}catch(e){setData(null);setError(e instanceof Error?e.message:'Unavailable')}}
 useEffect(()=>{void load()},[journalAsOf]);
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError('');
  try{
   const fields=new FormData(event.currentTarget),holdings=String(fields.get('holdings')).split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line=>{const match=/^([A-Z]{2}[A-Z0-9]{9}[0-9])\s+(\d+)$/.exec(line);if(!match)throw new Error('Enter each ISIN followed by its share quantity');return {isin:match[1],quantity:Number(match[2])}}),fillReferences=String(fields.get('references')).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
   const body=JSON.stringify({asOf,sourceReference:fields.get('source'),cash:fields.get('cash'),holdings,fillReferences,allOutsideActivityIncluded:fields.get('verified')==='on'});
   if(pending.current?.body!==body)pending.current={body,key:crypto.randomUUID()};
   const auth=await fetch('/api/v1/auth/session',{cache:'no-store'});if(!auth.ok)throw new Error('Sign in again to record a statement');const session=await auth.json();
   const response=await fetch('/api/v1/portfolio/reconciliation',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken,'idempotency-key':pending.current.key},body});
   const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Unable to record statement');pending.current=null;await load();
  }catch(e){setError(e instanceof Error?e.message:'Invalid statement')}finally{setBusy(false)}
 }
 return <section className="panel journalforms" aria-label="Broker reconciliation"><h2>Reconcile outside activity</h2><p>Compare all account holdings, cash and executed fill references against your journal. Use independent broker records, including activity entered outside this application. This records evidence and places no order.</p>
 <p role="status"><strong>{data?.state.replaceAll('_',' ')??'PORTFOLIO UNRECONCILED'}</strong> · {data?(data.reasons.join(', ')||'A matching statement confirms only its as-of time; other BUY risk gates still apply.'):'Reconciliation evidence unavailable.'}</p>
 {error&&<p className="error" role="alert">{error}</p>}
 {data?.latest&&<><p>Latest source: {data.latest.statement.sourceReference} · {data.latest.statement.asOf}</p>{data.latest.result.quantities.map(row=><p key={row.isin}>{row.isin}: journal {row.journal} shares; statement {row.statement} shares</p>)}{!!data.latest.result.missingInJournal.length&&<p>Missing from journal: {data.latest.result.missingInJournal.join(', ')}</p>}{!!data.latest.result.missingInStatement.length&&<p>Missing from statement: {data.latest.result.missingInStatement.join(', ')}</p>}</>}
 <form onSubmit={event=>void submit(event)}><div className="formgrid">
 <label className="field">Statement source reference<input name="source" required maxLength={200}/></label>
 <label className="field">Statement cash (INR)<input name="cash" required inputMode="decimal" pattern="-?[0-9]+(\.[0-9]{1,6})?"/></label>
 <label className="field">Statement as-of (UTC ISO)<input value={asOf} onChange={e=>setAsOf(e.target.value)} required placeholder="2026-10-20T06:00:00Z"/></label><button type="button" className="quiet" onClick={()=>setAsOf(new Date().toISOString())}>Use current timestamp</button></div>
 <label className="field">All statement holdings (ISIN then shares, one per line)<textarea name="holdings" rows={4} placeholder="INE000000001 10"/></label>
 <label className="field">All executed fill references since initial capital (one per line)<textarea name="references" rows={4}/></label>
 <label className="checkfield"><input name="verified" type="checkbox" required/> I checked all outside holdings, fills and cash movements against independent account records.</label>
 <button className="primary" disabled={busy}>{busy?'Comparing…':'Record reconciliation'}</button></form>
 {!!data?.history.length&&<details><summary>Statement history</summary><ul>{data.history.map(row=><li key={row.id}>{row.statement.asOf} · {row.statement.sourceReference} · {row.result.state}</li>)}</ul></details>}
 </section>;
}

