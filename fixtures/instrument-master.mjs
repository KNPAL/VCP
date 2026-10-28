export function masterFixture(asOf='2026-10-28T06:00:00Z'){
 const source={dataset:'instrument-master',provider:'fixture-smartapi',endpointOrFile:'synthetic-master.json',licenseRef:'synthetic-test-only',uses:{DOWNLOAD:false,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false},updateFrequency:'daily',asOf,knownAt:asOf,effectiveAt:asOf,validUntil:new Date(Date.parse(asOf)+60000).toISOString(),lastVerified:asOf,maximumAgeMs:60000,adjustmentPolicy:'RAW',coverage:{intended:1,available:1},error:null};
 const mapping={companyId:'00000000-0000-4000-8000-000000000091',listingId:'00000000-0000-4000-8000-000000000092',isin:'INE000000091',exchange:'NSE',series:'EQ',symbol:'SYNTH-EQ',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:source.provider,token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true};
 const row={token:'00123',symbol:'SYNTH-EQ',exch_seg:'nse_cm',instrumenttype:'',expiry:'',tick_size:'5.000000',lotsize:'1'};
 return {source,knownAt:asOf,tickDivisor:'100',mappings:[mapping],records:[row]};
}
