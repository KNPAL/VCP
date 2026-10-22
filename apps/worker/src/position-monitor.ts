import type {Queue} from 'bullmq';
import {readPortfolio,recordPositionMonitor,evaluatePositionStop,recordPortfolioRisk,evaluatePositionTrail,evaluatePartialProfit,evaluateExitDecisions,recordPositionStatus,type PortfolioQuotes,type PrismaClient} from '@vcp/database';

import {assessHeldQuote,canonicalListings,type CalendarDay,type InstrumentSnapshot,type MonitorAssessment} from '@vcp/market-data';
import {readLiveQuote} from './live-quotes.js';
export async function monitorHeldPositions(db:PrismaClient,q:Queue,streamOwner:string|undefined){
 const trails:{ownerId:string;isin:string;quote:PortfolioQuotes[string]|null}[]=[];
 const owners=await db.owner.findMany({select:{id:true}});
 const calendar=await db.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "createdAt"<=clock_timestamp() ORDER BY "createdAt" DESC,"id" LIMIT 1`;
 const mappings=await db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=clock_timestamp() ORDER BY "knownAt" DESC,"id" LIMIT 1`;
 const mapping=mappings[0]?.evidence??null;
 for(const owner of owners){
  const portfolio=await readPortfolio(db,owner.id),assessments:Record<string,MonitorAssessment>={},quotes:PortfolioQuotes={};
  for(const isin of Object.keys(portfolio.holdings)){
   const asOf=new Date().toISOString();
   let quote:Awaited<ReturnType<typeof readLiveQuote>>={state:'UNKNOWN',reason:'STREAM_OWNER_UNCONFIGURED'};
   try{
    const listing=canonicalListings(mapping?[mapping]:[],[isin],asOf)[0]?.primary;
    if(listing&&streamOwner){
     let timer:ReturnType<typeof setTimeout>|undefined;
     try{quote=await Promise.race([readLiveQuote(q,streamOwner,listing.listingId),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('QUOTE_STORE_UNAVAILABLE')),1000)})]);}finally{clearTimeout(timer)}
    }
   }catch{quote={state:'UNKNOWN',reason:'QUOTE_STORE_UNAVAILABLE'}}
   assessments[isin]=assessHeldQuote(isin,new Date().toISOString(),calendar[0]?.evidence??null,mapping,quote);
   if(quote.state==='KNOWN')quotes[isin]=quote.quote;
   await evaluatePositionStop(db,owner.id,isin,assessments[isin]!.state==='FEED_FRESH'&&quote.state==='KNOWN'?quote.quote:null);
   trails.push({ownerId:owner.id,isin,quote:assessments[isin]!.state==='FEED_FRESH'&&quote.state==='KNOWN'?quote.quote:null});
  }
  await recordPositionMonitor(db,owner.id,assessments);
  await recordPortfolioRisk(db,owner.id,quotes);
 }
 // EOD work runs only after every owner has received live protective evaluation.
 for(const item of trails)await evaluatePositionTrail(db,item.ownerId,item.isin);
 for(const item of trails)await evaluatePartialProfit(db,item.ownerId,item.isin,item.quote);
 for(const item of trails)await evaluateExitDecisions(db,item.ownerId,item.isin);
 for(const item of trails)await recordPositionStatus(db,item.ownerId,item.isin,item.quote);
}




