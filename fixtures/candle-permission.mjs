import {persistSource} from '../packages/database/dist/index.js';
export async function candlePermission(db,provider,uses={}){
 const now=new Date(Date.now()-1000).toISOString();
 return persistSource(db,{dataset:'DAILY_CANDLES',provider,endpointOrFile:'synthetic:'+provider,licenseRef:'synthetic-only',uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false,...uses},updateFrequency:'daily',asOf:now,knownAt:now,effectiveAt:now,validUntil:new Date(Date.now()+3600000).toISOString(),lastVerified:now,maximumAgeMs:3600000,adjustmentPolicy:'synthetic',coverage:{intended:1,available:1},error:null});
}
