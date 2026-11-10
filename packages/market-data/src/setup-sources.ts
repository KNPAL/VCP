export const catalogUrls={angel:'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json',equities:'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv',universe:'https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv'};
export async function sourceText(url:string,maxBytes:number){
 if(!Object.values(catalogUrls).includes(url)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>40*1024*1024)throw new Error('Invalid reference source request');
 try{const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(45000),headers:{'User-Agent':'VCP-market-data-setup/1.0','Accept':'application/json,text/csv,*/*'}});if(!response.ok||!response.body)throw new Error();let bytes=0;const chunks:Uint8Array[]=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>maxBytes)throw new Error();chunks.push(chunk)}return Buffer.concat(chunks).toString('utf8')}
 catch{throw new Error('The official data source '+new URL(url).hostname+' could not be downloaded. Please retry; existing data has been retained.');}
}
