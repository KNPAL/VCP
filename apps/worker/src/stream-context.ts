import {exchangeDate,parseFixed,formatFixed} from '@vcp/domain';
import {brokerAccountKey,verifiedCalendar,type CalendarDay,type InstrumentSnapshot,type StreamCandidate} from '@vcp/market-data';
import {readMarketSignals,readPortfolio,latestScan,resolveBrokerSession,type PrismaClient,type BrokerKeyResolver} from '@vcp/database';
import {activeEntryCandidates} from './entry-candidates.js';
import type {StreamContext,StreamOwnerDependencies} from './stream-owner.js';
import {connectSmartApiSocket} from './smartapi-socket.js';

export function streamDependencies(db:PrismaClient,accountKey:string,loadKey:BrokerKeyResolver):StreamOwnerDependencies {
 if(!/^[0-9a-f]{64}$/.test(accountKey))throw new Error('INVALID_STREAM_ACCOUNT');
 async function credentials(){
  const rows=await db.$queryRaw<{reference:string}[]>`SELECT s."reference" FROM "BrokerCredential" s JOIN "BrokerCircuit" c ON c."accountKey"=s."accountKey" AND c."sessionRevision"=s."sessionRevision" WHERE s."accountKey"=${accountKey} AND NOT c."open" AND c."verifiedAt"<=clock_timestamp() AND c."expiresAt">clock_timestamp() ORDER BY s."expiresAt" DESC,s."reference" LIMIT 1`;
  if(!rows[0])throw new Error('STREAM_UNAVAILABLE');
  const value=await resolveBrokerSession(db,rows[0].reference,loadKey),{clientCode,feedToken}=value.secrets;
  if(!clientCode||!feedToken||brokerAccountKey(clientCode)!==accountKey)throw new Error('STREAM_UNAVAILABLE');
  return {...value,credentials:{accessToken:value.secrets.accessToken,apiKey:value.secrets.apiKey,clientCode,feedToken}};
 }
 return {
  context:async()=>{
   const at=new Date().toISOString(),date=exchangeDate(at);
   const auth=await credentials();
   const calendars=await db.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "createdAt"<=${new Date(at)} ORDER BY "createdAt" DESC,"id" LIMIT 1`;
   const mappings=await db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${new Date(at)} ORDER BY "knownAt" DESC,"id" LIMIT 1`;
   const calendar=calendars[0]?.evidence??null,mapping=mappings[0]?.evidence??null;
   const verified=verifiedCalendar(calendar,date,date,at),day=calendar?.find(d=>d.date===date);
   const session=verified.state==='KNOWN'&&day&&day.kind!=='HOLIDAY'?{date,opensAt:day.opensAt!,closesAt:day.closesAt!,knownAt:day.knownAt,verified:true}:null;
   const holdings:string[]=[];
   for(const owner of await db.owner.findMany({select:{id:true}})){const portfolio=await readPortfolio(db,owner.id);holdings.push(...Object.keys(portfolio.holdings))}
   const candidates:StreamCandidate[]=[],scan=await latestScan(db);
   if(scan&&session&&scan.asOf<=at&&calendar){
    const scanDate=exchangeDate(scan.asOf),range=verifiedCalendar(calendar,scanDate,date,at),last=range.sessions.at(-1);
    // A stale or incomplete calendar cannot keep yesterday's candidates subscribed indefinitely.
    if(range.state==='KNOWN'&&last?.date===scanDate){
     for(const row of scan.candidates){
      if(!['READY','WATCH'].includes(row.marketState)||row.missingData.length||!row.pivot||!row.close)continue;
      const listing=mapping?.rows.find(r=>r.listingId===row.instrumentId&&r.validFrom<=date&&(r.validTo===null||date<r.validTo));
      const pivot=parseFixed(row.pivot),close=parseFixed(row.close);if(!listing||pivot<=0n||close<=0n)continue;
      candidates.push({isin:listing.isin,state:row.marketState as 'READY'|'WATCH',distanceToPivot:formatFixed(pivot>close?pivot-close:0n),pivot:row.pivot,validUntil:session.closesAt});
     }
    }
   }
   // Use READY subscription priority for active confirmed breakouts; stored market state is unchanged.
   for(const candidate of activeEntryCandidates((await readMarketSignals(db)).items,mapping,calendar,at))candidates.push({isin:candidate.isin,state:'READY',distanceToPivot:'0',pivot:candidate.pivot,validUntil:candidate.validUntil});
   return {mapping,session,holdings,candidates,credentialRevision:auth.sessionRevision,credentialExpiresAt:auth.expiresAt} satisfies StreamContext;
  },
  connect:async(context,callbacks,signal)=>{
   const auth=await credentials();
   if(auth.sessionRevision!==context.credentialRevision)throw new Error('STREAM_UNAVAILABLE');
   return connectSmartApiSocket(auth.credentials,callbacks,signal);
  },
 };
}
