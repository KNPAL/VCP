import type {PrismaClient} from '@prisma/client';
import {assertRegisteredSourceIds} from './source-authority.js';
type Reader=Pick<PrismaClient,'$queryRaw'>;
async function latest(db:Reader,ownerId:string){
 const [batch]=await db.$queryRaw<{id:string;sourceSnapshotId:string;manifest:Record<string,unknown>;createdAt:Date}[]>`SELECT id,"sourceSnapshotId",manifest,"createdAt" FROM "HistoricalDataImport" WHERE "ownerId"=${ownerId}::uuid AND status='COMPLETED' ORDER BY "createdAt" DESC,id LIMIT 1`;
 if(batch)await assertRegisteredSourceIds(db,'DAILY_CANDLES',[batch.sourceSnapshotId],['DISPLAY','DERIVE']);
 return batch;
}
export async function importedHistoryChoices(db:Reader,ownerId:string){
 const batch=await latest(db,ownerId);if(!batch)return {importId:null,items:[],summary:null};
 const items=await db.$queryRaw<{symbol:string;series:string;count:number;valid:number;from:string;to:string}[]>`SELECT symbol,series,count(*)::int AS count,count(*) FILTER (WHERE quality='VALID')::int AS valid,min(session)::text AS "from",max(session)::text AS "to" FROM "HistoricalResearchBar" WHERE "importId"=${batch.id} GROUP BY symbol,series ORDER BY (series='EQ') DESC,symbol,series`;
 const {priceRows,symbols,from,to,quality,priceBasis}=batch.manifest;
 return {importId:batch.id,items,summary:{priceRows,symbols,from,to,quality,priceBasis,importedAt:batch.createdAt.toISOString()}};
}
export function historySelection(input:{symbol?:string;series?:string;from?:string;to?:string}){
 const {symbol,series,from,to}=input;
 const date=(v:string|undefined)=>!!v&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 if(!symbol||symbol.length>50||!series||series.length>10||!date(from)||!date(to)||from!>to!||Date.parse(to!)-Date.parse(from!)>3660*86400000)throw new Error('INVALID_HISTORY_SELECTION');
 return {symbol,series,from:from!,to:to!};
}
export function historicalAverages(rows:{session:string;close:string}[]){
 const sums=new Map<number,number>();
 return rows.map((row,i)=>{const values:Record<string,number|null>={};for(const period of [50,150,200]){const sum=(sums.get(period)??0)+Number(row.close)-(i>=period?Number(rows[i-period]!.close):0);sums.set(period,sum);values['sma'+period]=i+1>=period?Number((sum/period).toFixed(6)):null}return {...row,...values}});
}
export async function importedHistorySeries(db:Reader,ownerId:string,input:{symbol?:string;series?:string;from?:string;to?:string}){
 const selection=historySelection(input),batch=await latest(db,ownerId);
 if(!batch)throw new Error('HISTORY_IMPORT_NOT_FOUND');
 const rows=await db.$queryRaw<{session:string;open:string;high:string;low:string;close:string;volume:string}[]>`SELECT session::text,open::text,high::text,low::text,close::text,volume::text FROM "HistoricalResearchBar" WHERE "importId"=${batch.id} AND symbol=${selection.symbol} AND series=${selection.series} AND session<=${new Date(selection.to)} AND quality='VALID' ORDER BY session LIMIT 10000`;
 const averages=historicalAverages(rows),bars=rows.map((r,i)=>({...r,...averages[i]})).filter(r=>r.session>=selection.from);
 const excluded=await db.$queryRaw<{reason:string;count:number}[]>`SELECT reason,count(*)::int AS count FROM "HistoricalResearchBar",jsonb_array_elements_text(reasons) reason WHERE "importId"=${batch.id} AND symbol=${selection.symbol} AND series=${selection.series} AND session BETWEEN ${new Date(selection.from)} AND ${new Date(selection.to)} AND quality<>'VALID' GROUP BY reason ORDER BY reason`;
 return {importId:batch.id,...selection,bars,excluded,priceBasis:'UNADJUSTED',analysisBasis:'Moving averages use available valid observations, including warmup before the selected range. Missing sessions are not filled. Corporate actions can create price jumps. This view does not publish VCP signals.'};
}

export async function importedVcpResearchScan(db:Reader,ownerId:string){
 const [row]=await db.$queryRaw<{id:string;evidence:{sourceSnapshotIds:string[]}}[]>`SELECT id,evidence FROM "ImportedVcpResearchScan" WHERE "ownerId"=${ownerId}::uuid ORDER BY "createdAt" DESC,id LIMIT 1`;
 if(!row)return null;
 for(const [index,dataset] of ['DAILY_CANDLES','CORPORATE_ACTIONS','BENCHMARK'].entries())await assertRegisteredSourceIds(db,dataset,[row.evidence.sourceSnapshotIds[index]],['DISPLAY','DERIVE']);
 return {id:row.id,...row.evidence};
}
