export function smeEvidence(asOf='2026-10-20T06:00:00.000Z'){
 const until=new Date(Date.parse(asOf)+3600000).toISOString();
 return {listingId:'00000000-0000-4000-8000-000000000003',isin:'INE000000001',exchange:'NSE',segment:'SME',exchangeSegmentCode:'SME',segmentVerified:true,lot:100,lotVerified:true,knownAt:asOf,
 source:{dataset:'synthetic-sme',provider:'fixture',endpointOrFile:'synthetic-source',licenseRef:'test-only',uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false},updateFrequency:'daily',asOf,knownAt:asOf,effectiveAt:asOf,validUntil:until,lastVerified:asOf,maximumAgeMs:3600000,adjustmentPolicy:'verified-effective-actions',coverage:{intended:1,available:1},error:null},
 restrictions:{verified:true,knownAt:asOf,validUntil:until,sourceAt:asOf,asm:false,gsm:false,esm:false,cashTradable:true,lowerBand:'90',upperBand:'110'},thinExecutionAssumptions:['Sparse trading may prevent fills; OHLC prices do not guarantee execution.']};
}
