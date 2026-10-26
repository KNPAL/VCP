'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
type Latest={runId:string;status:string;request:{universeId:string;fromDate:string;toDate:string;interval:string};candleChanges:{newCandles:string;revisedCandles:string};progress:{checkedAt:string;instruments:{storedCandles:number|null;latestStoredSession:string|null}[]};events:{evidence:{reason?:string}}[]};
export default function LatestDownload(){
 const [run,setRun]=useState<Latest|null>(null),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function read(url:string){const response=await fetch(url,{cache:'no-store',signal:c.signal});if(!response.ok)throw new Error(`${response.status} — Latest download status unavailable`);return response.json()}
  async function refresh(){try{const list=await read('/api/v1/history/downloads'),id=list.items[0]?.runId,next=id?await read('/api/v1/history/downloads/'+encodeURIComponent(id)):null;if(!c.signal.aborted){setRun(next);setLoaded(true);setError('')}}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Latest download status unavailable')}finally{if(!c.signal.aborted)timer=setTimeout(()=>void refresh(),5000)}}
  void refresh();return()=>{c.abort();clearTimeout(timer)};
 },[]);
 const counts=run?.progress.instruments.map(i=>i.storedCandles)??[],stored=counts.length&&counts.every(n=>n!==null)?counts.reduce<number>((total,n)=>total+(n??0),0):null,latest=run?.progress.instruments.flatMap(i=>i.latestStoredSession?[i.latestStoredSession]:[]).sort().at(-1);
 return <section className="panel"><h2>Latest historical download</h2>{error&&<p role="alert">{error}. Last displayed evidence may be stale.</p>}{!loaded&&!error&&<p role="status">Loading latest download…</p>}{loaded&&!run&&<p>No historical download requests recorded.</p>}{run&&<><p>{run.status} · {run.request.universeId} · {run.request.interval}<br/>{run.request.fromDate} – {run.request.toDate}</p><p>Stored candles: {stored??'UNKNOWN'} · New: {run.candleChanges.newCandles} · Revised: {run.candleChanges.revisedCandles}<br/>Latest stored market date: {latest??'UNKNOWN'}</p><p>Last checked {new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(run.progress.checkedAt))} IST · refreshes every five seconds</p><p>{run.events.at(-1)?.evidence.reason??'No status reason recorded'}</p><Link href={'/data/historical/downloads/'+run.runId}>Open latest download details</Link></>}</section>;
}
