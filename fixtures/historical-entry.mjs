import {entryInput,clock} from './signal-golden.mjs';
import {valuePortfolio} from '../packages/portfolio/dist/index.js';
export function historicalEntryFixture(){
 const market=entryInput(),now=clock(51,'04:00:00');
 return {snapshotId:'synthetic-snapshot',event:market.event,now,earliestFillAt:now,opening:{price:'101',sourceAt:now,knownAt:now,sourceReference:'synthetic-opening'},portfolio:valuePortfolio({cash:'100000',cashVerified:true,reconciled:true,holdings:[],asOf:now}),isin:'INE000000001',sector:'TECH',lotSize:1,lossStreakPass:true,market,fees:{buyBps:'10',sellBps:'10',slippageBps:'10',minimumFee:'1',sourceReference:'synthetic-costs'}};
}
