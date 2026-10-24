import {goldenSeries} from './vcp-golden.mjs';
import {ST_VCP_4_0} from '../packages/strategy/dist/index.js';
export function historicalReplayFixture(){
 const series=goldenSeries(),listingId='00000000-0000-4000-8000-000000000003',isin='INE000000001',knownAt='2023-12-31T00:00:00Z';
 const nextDate=date=>new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
 const signalDate=nextDate(series.bars.at(-1).session),fillDate=nextDate(signalDate);
 const bars=[...series.bars,{...series.bars.at(-1),session:signalDate,open:'101',high:'102',low:'100',close:'101',volume:'200',revision:'breakout',endedAt:signalDate+'T10:00:00Z',finalizedAt:signalDate+'T10:30:00Z'}];
 const dates=[...bars.map(bar=>bar.session),fillDate];
 const input={from:dates[0],through:fillDate,knownAt:fillDate+'T11:00:00Z',strategySha:'a'.repeat(40),strategyConfiguration:ST_VCP_4_0,seed:7,fees:{buyBps:'1',sellBps:'2',slippageBps:'3',minimumFee:'0',sourceReference:'synthetic-costs'},historicalDelistingsVerified:true,
 universes:[{id:'universe',universe:'NIFTY_500',knownAt,effectiveFrom:'2023-12-31',effectiveTo:null,sourceReference:'synthetic',historicalConstituentsVerified:true,isins:[isin]}],
 instruments:[{id:'mapping',knownAt,sourceReference:'synthetic',rows:[{companyId:listingId,isin,listingId,exchange:'NSE',series:'EQ',symbol:'TEST',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'synthetic',token:'1',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]}],
 calendar:dates.map(date=>({date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt,source:'synthetic',verified:true})),
 actions:[{id:'actions',listingId,knownAt,verified:true,sourceReference:'synthetic',coverageFrom:dates[0],coverageThrough:fillDate,actions:[]}],
 raw:bars.map(bar=>({...bar,listingId,provider:'synthetic',receivedAt:bar.finalizedAt,zeroVolumeVerified:false,revisionId:bar.revision,revision:1}))};
 const assumptions=dates.map(session=>({session,knownAt:session+'T10:30:00Z',sourceReference:'synthetic-asof-state',portfolio:{cash:'100000',positions:[]},market:{state:'GREEN'},quote:{state:'EOD_ONLY'},strength:{[listingId]:{value:'85',revision:'rs-'+session,knownAt:session+'T10:30:00Z'}}}));
 return {input,assumptions,signalDate,fillDate};
}
