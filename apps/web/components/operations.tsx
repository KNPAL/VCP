'use client';
import {useEffect,useState} from 'react';

type Metrics={
 asOf:string;readiness:string;gates:{gate:string;status:string}[];
 brokerConfigured:boolean;attempts:{hour:string;requests:number;errors:number;forbidden:number;limited:number}[];
 workerQueue:{waiting:number;failed:number;active:number;oldestSeconds:number|null}|null;
 queue:{due:number;oldest:string|null;failed:number};monitor:{held:number;stale:number};
 feedAgeSeconds:number|null;pendingSell:number|null;finalizedSession:string|null;
 scan:{counts:{intended:number;analyzed:number};publicationLagSeconds:number;status:string}|null;
 scanSla:{targetSeconds:number;state:string}|null;adjustment:{id:string;state:string}|null;
 disk:{freePercent:number;state:string}|null;backup:{completedAt:string;state:string}|null;
};
const ist=(t:string)=>new Date(t).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST';
export default function Operations(){
 const [data,setData]=useState<Metrics|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const c=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function refresh(){
   try{
    const response=await fetch('/api/v1/data/operations',{cache:'no-store',signal:c.signal});
    if(!response.ok)throw Error('Operations unavailable ('+response.status+').');
    const value=await response.json();
    if(!c.signal.aborted){setData(value);setError('')}
   }catch(e){if(!c.signal.aborted){setData(null);setError(e instanceof Error?e.message:'Operations unavailable')}}
   finally{if(!c.signal.aborted)timer=setTimeout(refresh,30000)}
  }
  void refresh();return()=>{c.abort();clearTimeout(timer)};
 },[revision]);
 return <><div className="pagehead"><div><h1>Operations</h1><p>Source freshness and service readiness</p></div><button onClick={()=>setRevision(n=>n+1)}>Refresh operations</button></div>
 {error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">Loading operations…</p>}{data&&<>
 <section className="panel"><h2>Readiness · {data.readiness}</h2><p>Checked {ist(data.asOf)}</p><ul>{data.gates.map(g=><li key={g.gate}>{g.gate} · {g.status}</li>)}</ul></section>
 <section className="panel"><h2>Feed and queues</h2><dl>
 <dt>Latest monitored quote age</dt><dd>{data.feedAgeSeconds===null?'UNKNOWN':data.feedAgeSeconds+' seconds'}</dd>
 <dt>Stale or degraded position streams</dt><dd>{data.monitor.stale} of {data.monitor.held} monitored</dd>
 <dt>Outstanding SELL deliveries</dt><dd>{data.pendingSell??'UNKNOWN'}</dd>
 <dt>Worker queue · waiting / active / failed</dt><dd>{data.workerQueue?[data.workerQueue.waiting,data.workerQueue.active,data.workerQueue.failed].join(' / '):'UNKNOWN'}</dd>
 <dt>Oldest waiting job age</dt><dd>{data.workerQueue?(data.workerQueue.oldestSeconds===null?'None waiting':data.workerQueue.oldestSeconds+' seconds'):'UNKNOWN'}</dd>
 <dt>Historical windows due / failed</dt><dd>{data.queue.due} / {data.queue.failed}</dd>
 <dt>Oldest due window</dt><dd>{data.queue.oldest?Math.floor((Date.parse(data.asOf)-Date.parse(data.queue.oldest))/1000)+' seconds overdue':'None due'}</dd>
 </dl></section><section className="panel"><h2>Data and scans</h2><dl>
 <dt>Last finalized daily session</dt><dd>{data.finalizedSession??'UNKNOWN'}</dd>
 <dt>Latest scan coverage</dt><dd>{data.scan?data.scan.counts.analyzed+' / '+data.scan.counts.intended+' analyzed · '+data.scan.status:'UNKNOWN'}</dd>
 <dt>Scan publication lag / SLA</dt><dd>{data.scan?data.scan.publicationLagSeconds+' seconds':'UNKNOWN'} · {data.scanSla?data.scanSla.state+' (target '+data.scanSla.targetSeconds+' seconds)':'Target unknown'}</dd>
 <dt>Latest adjustment revision</dt><dd className="evidence-id">{data.adjustment?data.adjustment.id+' · '+data.adjustment.state:'UNKNOWN'}</dd>
 <dt>Monitored volume free</dt><dd>{data.disk?data.disk.freePercent.toFixed(1)+'% · '+data.disk.state:'UNKNOWN'}</dd>
 <dt>Last database backup receipt</dt><dd>{data.backup?data.backup.state+' · '+ist(data.backup.completedAt):'UNKNOWN'}</dd></dl></section>
 <section className="panel"><h2>Broker requests · last 24 hours</h2>{data.attempts.length?<table><caption>Hourly request outcomes</caption><thead><tr>{['Hour (IST)','Attempts','Error rate','403','429'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.attempts.map(h=><tr key={h.hour}><td>{ist(h.hour)}</td><td>{h.requests}</td><td>{(100*h.errors/h.requests).toFixed(1)}%</td><td>{h.forbidden}</td><td>{h.limited}</td></tr>)}</tbody></table>:<p>{data.brokerConfigured?'No recorded attempts in this period.':'UNKNOWN · broker account unavailable.'}</p>}</section></>}</>;
}
