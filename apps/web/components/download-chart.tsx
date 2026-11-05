'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
type Series={symbol:string;bars:{session:string;close:string}[]};
export default function StoredCandles({runId,listing}:{runId:string;listing:string}){
 const [series,setSeries]=useState<Series|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  async function load(){
   setSeries(null);setError('');
   try{
    const response=await fetch('/api/v1/history/downloads/'+encodeURIComponent(runId)+'/candles/'+encodeURIComponent(listing),{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('Stored candles unavailable ('+response.status+').');
    const result=await response.json();if(!controller.signal.aborted)setSeries(result);
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Stored candles unavailable')}
  }
  void load();return ()=>controller.abort();
 },[runId,listing]);
 const prices=series?.bars.map(bar=>Number(bar.close))??[],low=Math.min(...prices),high=Math.max(...prices);
 const points=prices.map((price,index)=>[8+index*784/Math.max(1,prices.length-1),high===low?100:192-(price-low)*184/(high-low)].join(',')).join(' ');
 return <section className="panel"><Link href={'/data/historical/downloads/'+runId}>Back to download</Link><h1>Stored closing prices{series?' · '+series.symbol:''}</h1>
 {error?<p role="alert">{error}</p>:!series?<p role="status">Loading candles…</p>:!series.bars.length?<p>No finalized candles stored for this range.</p>:<>
 <p>Last finalized session: {series.bars.at(-1)?.session} · Close: {series.bars.at(-1)?.close}</p>
 <svg viewBox="0 0 800 200" role="img" aria-label={series.symbol+' daily closing prices from '+series.bars[0]?.session+' to '+series.bars.at(-1)?.session} style={{width:'100%'}}>
 {prices.length===1?<circle cx="8" cy="100" r="4" fill="currentColor"/>:<polyline fill="none" stroke="currentColor" strokeWidth="2" points={points}/>}</svg>
 <details><summary>Closing prices by session</summary><table><thead><tr><th>Session</th><th>Close</th></tr></thead><tbody>{series.bars.map(bar=><tr key={bar.session}><td>{bar.session}</td><td>{bar.close}</td></tr>)}</tbody></table></details></>}</section>;
}
