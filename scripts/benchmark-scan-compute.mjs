import assert from 'node:assert/strict';
import {cpus,platform,arch} from 'node:os';
import {performance} from 'node:perf_hooks';
import {goldenSeries} from '../fixtures/vcp-golden.mjs';
import {relativeStrength,percentiles,adv20,sma,marketRegime,snapshot} from '../packages/indicators/dist/index.js';
import {companyCandidate,configurationHash,dailyBreakout,detectDailyStructure,rankCandidates,ST_VCP_4_0} from '../packages/strategy/dist/index.js';

// Reproducible compute-only workload. Fixture generation and prior-day freezes
// happen before timing, as they would for a scan over already finalized inputs.
const history=goldenSeries(),benchmark={...history,priceScale:'ADJUSTED'};
const configHash=configurationHash(ST_VCP_4_0),stocks=[];
for(let n=0;n<500;n++){
 const listingId='00000000-0000-4000-8000-'+String(n+1).padStart(12,'0');
 const bars=history.bars.map((b,i)=>({...b,revision:listingId+'-'+i,volume:String(Number(b.volume)*50000+n)}));
 const series={...history,bars,priceScale:'ADJUSTED',dataRevision:listingId};
 const input={listingId,series,tick:'0.05',adjustmentRevision:listingId,scaleRevision:'fixture',configHash,decidedAt:series.asOf,strength:null};
 const priorBars=bars.slice(0,-1),priorTime=priorBars.at(-1).finalizedAt;
 const prior=detectDailyStructure({...input,decidedAt:priorTime,series:{...series,bars:priorBars,sessions:series.sessions.slice(0,-1),asOf:priorTime}}).frozen;
 stocks.push({isin:'INE'+String(n+1).padStart(9,'0'),input,prior});
}
const started=performance.now(),intended=stocks.map(s=>s.isin);
const strengths=stocks.map(({isin,input})=>({isin,value:relativeStrength(input.series,benchmark).value?.raw??null}));
const ranks=percentiles(intended,strengths);
assert.equal(ranks.state,'KNOWN');
const breadth=stocks.map(({isin,input})=>({isin,close:input.series.bars.at(-1).close,sma50:sma(input.series,50).value}));
const regime=marketRegime(benchmark.bars.at(-1).close,sma(benchmark,50).value,sma(benchmark,200).value,intended,breadth);
const candidates=stocks.map(({isin,input,prior})=>{
 const rs=ranks.values[isin],series=input.series;
 const daily={...input,strength:{value:rs,revision:'fixture-ranks',knownAt:series.asOf}};
 const indicators=snapshot(series,rs),detector=detectDailyStructure(daily),breakout=dailyBreakout(daily,prior);
 assert.equal(indicators.sma200.state,'KNOWN');
 const turnover=adv20({...series,priceScale:'RAW'});
 return companyCandidate({listingId:input.listingId,patterns:detector.structure.patterns,close:series.bars.at(-1).close,
  rsPercentile:rs,adv20Median:turnover.value?.median??null,dataReasons:turnover.value?.eligible?[]:['TURNOVER_BELOW_MINIMUM'],
  confirmedMarketEventId:breakout.state==='BREAKOUT_CONFIRMED'?breakout.event.id:null});
});
const ranked=rankCandidates(candidates,{scanId:'synthetic-compute-benchmark',asOf:history.asOf,dataRevision:history.dataRevision,configHash});
const elapsedMs=performance.now()-started;
assert.equal(new Set(ranked.map(r=>r.instrumentId)).size,500);
console.log(JSON.stringify({measuredAt:new Date().toISOString(),environment:{node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model},input:'synthetic VCP golden history',stocks:ranked.length,sessionsPerListing:history.bars.length,regime:regime.regime,elapsedMs:Math.round(elapsedMs),targetMs:120000,passed:elapsedMs<=120000},null,2));
if(elapsedMs>120000)process.exitCode=1;
