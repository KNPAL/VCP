'use client';
import {useEffect,useRef,useState} from 'react';
type Portfolio={cash:string|null;asOf:string;equity:null;realizedPnl:string;positions:{isin:string;quantity:number;costBasis:string;realizedPnl:string}[];lots:{fillId:string;isin:string;remainingQty:number;price:string;remainingFees:string;occurredAt:string}[];events:{id:string;kind:string;isin?:string;side?:string;quantity?:number;price?:string;fees?:string;amount?:string;occurredAt:string;recordedAt:string;targetId?:string;replacementOf?:string;sourceId:string}[];reversed:string[]};
const ist=(value:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(value))+' IST';
const money=(value:string|null)=>value===null?'Unknown':'₹ '+value;
export default function PortfolioWorkspace(){
 const [data,setData]=useState<Portfolio|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[selected,setSelected]=useState('');
 const pending=useRef<{payload:string;key:string}|null>(null);
 async function load(signal?:AbortSignal){
  setLoading(true);setError('');
  try{const response=await fetch('/api/v1/portfolio',{cache:'no-store',...(signal?{signal}:{})});
   if(!response.ok)throw new Error(response.status===403?'Access denied. Your session does not permit this action.':response.status===401?'Your session expired. Sign in again.':response.status===503?'Portfolio service is unavailable. Previously recorded fills are retained.':'Unable to load portfolio ('+response.status+').');
   setData(await response.json());
  }catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setError(e instanceof Error?e.message:'Unable to load portfolio')}
  finally{setLoading(false)}
 }
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort()},[]);
 async function submit(event:React.FormEvent<HTMLFormElement>,kind:'cash'|'fill'){
  event.preventDefault();setBusy(true);setError('');setNotice('');const form=event.currentTarget,fields=new FormData(form);
  try{
   const occurredAt=new Date(String(fields.get('occurredAt'))+':00+05:30').toISOString();
   const body=kind==='cash'?{kind:fields.get('kind'),amount:fields.get('amount'),verified:true,occurredAt,sourceId:fields.get('sourceId')}:{isin:String(fields.get('isin')).toUpperCase(),side:fields.get('side'),quantity:Number(fields.get('quantity')),price:fields.get('price'),fees:fields.get('fees'),brokerReference:fields.get('brokerReference'),occurredAt,sourceId:fields.get('brokerReference')};
   const path=kind==='cash'?'/api/v1/portfolio/cash':body.side==='SELL'?'/api/v1/positions/'+body.isin+'/fills':'/api/v1/positions';
   const payload=JSON.stringify(body.side==='SELL'?Object.fromEntries(Object.entries(body).filter(([key])=>key!=='isin')):body);
   const identity=path+payload;if(pending.current?.payload!==identity)pending.current={payload:identity,key:crypto.randomUUID()};
   const sessionResponse=await fetch('/api/v1/auth/session',{cache:'no-store'});if(!sessionResponse.ok)throw new Error('Your session expired. Sign in again.');const session=await sessionResponse.json();
   const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken,'idempotency-key':pending.current.key},body:payload});
   const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Unable to record event');
   pending.current=null;form.reset();setNotice('Recorded in your immutable journal. Holdings reflect actual fills only.');await load();
  }catch(e){setError(e instanceof Error?e.message:'Request failed. Retry the same details to safely reuse the request key.')}
  finally{setBusy(false)}
 }
 const events=data?.events.filter(event=>!selected||event.isin===selected||data.events.some(target=>target.id===event.targetId&&target.isin===selected))??[];
 return <>
  <div className="pagehead"><div><div className="eyebrow">Portfolio / Actual execution</div><h1>My positions</h1><p>Record completed manual fills and review your cash and FIFO lots.</p></div><button className="quiet" onClick={()=>void load()} disabled={loading}>Refresh journal</button></div>
  <div className="note"><strong>Monitor degraded · verified market data unavailable</strong><span className="caption"> · Source freshness: unavailable</span><br/>Live marks, unrealized P&amp;L, EMA21, active stops and R-multiples are unknown. New BUY plans remain blocked until market data and portfolio reconciliation are verified.</div>
  {error&&<p className="error" role="alert">{error} <a href="/login">Sign in</a></p>}{notice&&<p role="status">{notice}</p>}
  {loading&&<p role="status">Loading recorded portfolio…</p>}
  {data&&<><p className="caption">Journal read: {ist(data.asOf)} · Source freshness: live quotes unavailable</p><div className="cards">
   {[['Recorded cash',money(data.cash)],['Open companies',String(data.positions.length)],['Realized P&L',money(data.realizedPnl)],['Marked equity','Unknown']].map(([label,value])=><section className="card" key={label}><div className="cardlabel">{label}</div><div className="value">{value}</div></section>)}
  </div><section className="panel"><h2>Actual holdings</h2>{data.positions.length===0?<p>No recorded open positions. A BUY signal does not create a holding.</p>:<div className="tablewrap"><table><caption className="caption">Remaining acquisition fees are included in FIFO cost basis.</caption><thead><tr><th>Company ISIN</th><th>Shares</th><th>FIFO cost basis</th><th>Realized P&amp;L</th><th>Live risk</th></tr></thead><tbody>{data.positions.map(position=><tr key={position.isin}><td><button className="quiet" onClick={()=>setSelected(position.isin)}>{position.isin}</button></td><td>{position.quantity}</td><td>{money(position.costBasis)}</td><td>{money(position.realizedPnl)}</td><td>Unknown · no verified mark</td></tr>)}</tbody></table></div>}</section></>}
  <div className="grid journalforms"><section className="panel"><h2>Record an executed fill</h2><p>Enter the actual broker execution. This form records your journal and places no order.</p><form onSubmit={event=>void submit(event,'fill')}>
   <div className="formgrid"><label className="field">Company ISIN<input name="isin" required pattern="[A-Z]{2}[A-Z0-9]{9}[0-9]" maxLength={12}/></label><label className="field">Execution side<select name="side"><option>BUY</option><option>SELL</option></select></label>
   <label className="field">Executed shares<input name="quantity" type="number" min="1" step="1" required/></label><label className="field">Actual price (INR)<input name="price" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" required/></label>
   <label className="field">Total fees (INR)<input name="fees" inputMode="decimal" defaultValue="0" pattern="[0-9]+(\.[0-9]{1,6})?" required/></label><label className="field">Executed at (IST)<input name="occurredAt" type="datetime-local" required/></label></div>
   <label className="field">Unique broker fill reference<input name="brokerReference" required maxLength={200}/></label><label className="checkfield"><input type="checkbox" required/> I confirm this fill was actually executed.</label><button className="primary" disabled={busy||loading||!data?.cash}>{busy?'Saving…':'Record actual fill'}</button>
  </form></section><section className="panel"><h2>{data?.cash===null?'Set initial capital':'Record cash movement'}</h2><p>Use verified account records. Include all outside activity before reconciling the portfolio.</p><form onSubmit={event=>void submit(event,'cash')}>
   <label className="field">Cash event<select name="kind">{(data?.cash===null?['INITIAL_CAPITAL']:['DEPOSIT','WITHDRAWAL','FEE','DIVIDEND','CORPORATE_CREDIT','CORPORATE_DEBIT']).map(kind=><option key={kind}>{kind}</option>)}</select></label>
   <label className="field">Amount (INR)<input name="amount" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" required/></label><label className="field">Occurred at (IST)<input name="occurredAt" type="datetime-local" required/></label><label className="field">Source record reference<input name="sourceId" required maxLength={200}/></label>
   <label className="checkfield"><input type="checkbox" required/> I verified this cash movement against my records.</label><button className="primary" disabled={busy||loading||!data}>Record cash event</button>
  </form></section></div>
  {data&&<section className="panel journalforms"><div className="panelhead"><h2>Immutable journal {selected&&'· '+selected}</h2>{selected&&<button className="quiet" onClick={()=>setSelected('')}>Show all events</button>}</div>
   {events.length===0?<p>No recorded events yet.</p>:<div className="tablewrap"><table><thead><tr><th>Execution time</th><th>Event</th><th>Company / source</th><th>Quantity / amount</th><th>Audit</th></tr></thead><tbody>{[...events].reverse().map(event=><tr key={event.id}><td>{ist(event.occurredAt)}<div className="caption">Recorded {ist(event.recordedAt)}</div></td><td>{event.side??event.kind}</td><td>{event.isin??event.sourceId}</td><td>{event.quantity?event.quantity+' @ '+money(event.price??null):money(event.amount??null)}</td><td>{data.reversed.includes(event.id)?'Reversed · original retained':event.targetId?'Reverses '+event.targetId:event.replacementOf?'Replaces '+event.replacementOf:'Original record'}<div className="caption">{event.id}</div></td></tr>)}</tbody></table></div>}
  </section>}
 </>;
}


