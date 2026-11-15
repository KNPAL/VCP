import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Q} from '../packages/indicators/dist/index.js';
const root='.runtime/official-nse/',input=JSON.parse(await readFile(root+'prepared-scan.json','utf8')),manifest=JSON.parse(await readFile(root+'bhavcopy-manifest.json','utf8')),proofs=[];
for(const stock of input.stocks.filter(s=>!s.reasons.length))for(const action of stock.adjustments){
 const prior=input.sessions.filter(s=>s.date<action.session).at(-1)?.date;
 if(!prior)throw new Error('Missing previous session');
 const record=manifest.find(r=>r.session===prior),key=prior.replaceAll('-','');
 if(!record)throw new Error('Download official bhavcopy for '+prior);
 const bytes=await readFile(root+'bhavcopy-'+key+'.zip');
 if(createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw new Error('Bhavcopy hash mismatch');
 const rows=JSON.parse(await readFile(root+'bhavcopy-'+key+'.json','utf8')),matches=rows.filter(r=>r.ISIN===stock.isin&&r.SctySrs==='EQ');
 const bar=stock.bars.find(b=>b.session===prior);
 if(matches.length!==1||!bar||Q.decimal(matches[0].ClsPric).fixed()!==Q.decimal(bar.close).fixed()||BigInt(matches[0].TtlTradgVol)!==BigInt(bar.volume))throw new Error('Action basis differs from official bhavcopy: '+stock.symbol);
 proofs.push({symbol:stock.symbol,effective:action.session,session:prior,close:bar.close,volume:bar.volume,url:record.url,sha256:record.sha256});
}
await writeFile(root+'action-bases.json',JSON.stringify(proofs,null,2));
console.log('Verified official pre-action bases: '+proofs.length);
