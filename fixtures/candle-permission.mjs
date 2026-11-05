import {randomUUID} from 'node:crypto';
import {benchmarkSeriesDigest,persistSource} from '../packages/database/dist/index.js';
export async function candlePermission(db,provider,uses={},dataset='DAILY_CANDLES'){
 const now=new Date(Date.now()-1000).toISOString();
 return persistSource(db,{dataset,provider,endpointOrFile:'synthetic:'+provider,licenseRef:'synthetic-only',uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false,...uses},updateFrequency:'daily',asOf:now,knownAt:now,effectiveAt:now,validUntil:new Date(Date.now()+3600000).toISOString(),lastVerified:now,maximumAgeMs:3600000,adjustmentPolicy:'synthetic',coverage:{intended:1,available:1},error:null});
}

export async function actionPermission(db){
 return (await candlePermission(db,'fixture-actions-'+randomUUID(),{},'CORPORATE_ACTIONS')).id;
}

export async function benchmarkReview(db,listingId,bars){
 const source=await candlePermission(db,'independent-fixture-'+randomUUID(),{},'BENCHMARK');
 return {identifier:'NIFTY_500_PRICE',listingId,sourceSnapshotId:source.id,knownAt:source.knownAt,seriesSha256:benchmarkSeriesDigest(bars)};
}
