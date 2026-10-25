import {createHash} from 'node:crypto';
import {detectDailyStructure,dailyBreakout,configurationHash,ST_VCP_4_0} from '../packages/strategy/dist/index.js';
import {goldenSeries} from './vcp-golden.mjs';
export function inspectorFixture(listingId='00000000-0000-4000-8000-000000000003'){
 const series={...goldenSeries(),priceScale:'ADJUSTED'},input={listingId,series,tick:'0.05',adjustmentRevision:'synthetic-inspector',scaleRevision:'no-actions',configHash:configurationHash(ST_VCP_4_0),decidedAt:series.asOf,strength:{value:'85',revision:'synthetic-rs',knownAt:series.asOf}};
 return {id:createHash('sha256').update(JSON.stringify(input)).digest('hex'),input,previousId:null,detector:detectDailyStructure(input),breakout:dailyBreakout(input,null)};
}
