import type {PrismaClient} from '@prisma/client';
import {synchronizeCandles,type SyncInput,type SyncRange,type DailyCandle} from '@vcp/market-data';
import {ingestCandles} from './candles.js';

export async function synchronizeStoredCandles(db:PrismaClient,input:Omit<SyncInput,'storedSessions'>,gateway:{fetch:(range:SyncRange)=>Promise<readonly DailyCandle[]>;now:()=>string}){
 const rows=await db.$queryRaw<{session:Date}[]>`SELECT "session" FROM "RawDailyCandle" WHERE "listingId"=${input.listingId}::uuid AND "provider"=${input.provider} AND "session">=${new Date(input.from)} AND "session"<=${new Date(input.to)} AND "finalizedAt"<=${new Date(input.asOf)} AND "receivedAt"<=${new Date(input.asOf)}`;
 return synchronizeCandles({...input,storedSessions:rows.map(row=>row.session.toISOString().slice(0,10))},{...gateway,commit:batch=>ingestCandles(db,batch)});
}
