'use client';
import {useEffect,useState} from 'react';
type Result={items:{isin:string;quantity:number;state:string;reason:string|null;record:{stop:{activeStop:string}|null;recordedAt:string}|null}[];signals:{id:string;isin:string;quantity:number;triggeredPrice:string;activeStop:string;observedTickAt:string;recognizedAt:string;quality:string}[]};
const time=(value:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(value))+' IST';
export default function ProtectiveStopsWorkspace(){
 const [data,setData]=useState<Result|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();const load=async()=>{try{const response=await fetch('/api/v1/positions/stops',{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Stop evidence unavailable');setData(await response.json());setError('')}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Unavailable')}};
 void load();const timer=setInterval(()=>void load(),5000);return()=>{controller.abort();clearInterval(timer)}},[]);
 return <section className="panel journalforms" aria-label="Protective stop evidence"><h2>Protective stops and observations</h2><p>Recorded initial stops are structural evidence. A protective SELL observation requests manual review; it never places an order or records a fill. Current feed and corporate-action verification are required for evaluation.</p>
 {error&&<p role="alert" className="error">{error} · Previously displayed records are historical; current protection is unknown.</p>}
 {!data&&!error&&<p role="status">Loading stop evidence…</p>}
 {data&&data.items.length===0&&<p>No recorded open holdings.</p>}
 {data?.items.map(item=><div className="card" key={item.isin}><strong>{item.isin} · {item.quantity} current shares</strong><p>Recorded initial stop: {item.state==='KNOWN'&&item.record?.stop?'₹ '+item.record.stop.activeStop:'Unknown'}{item.reason&&' · '+item.reason.replaceAll('_',' ')}</p>{item.record&&<p className="caption">Recorded {time(item.record.recordedAt)}</p>}</div>)}
 {!!data?.signals.length&&<details open><summary>Recorded protective SELL observations</summary>{data.signals.map(signal=><div className="note" key={signal.id}><strong>SELL PROTECTIVE · {signal.isin}</strong><p>Observed price ₹ {signal.triggeredPrice} · Stop ₹ {signal.activeStop} · {signal.quantity} shares at detection</p><p className="caption">Quote {time(signal.observedTickAt)} · Recognized {time(signal.recognizedAt)} · {signal.quality}</p><p>Holdings change only when you record an actual fill. This observation does not confirm execution.</p></div>)}</details>}
 </section>;
}
