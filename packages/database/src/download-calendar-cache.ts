import type {PrismaClient} from '@prisma/client';
import type {CalendarDay} from '@vcp/market-data';
import {authorizeCalendarRows} from './calendar-permissions.js';

/** Request-scoped only: recheck authority on every poll, share immutable calendars within it. */
export async function downloadCalendars(db:Pick<PrismaClient,'$queryRaw'>,ids:readonly string[]){
 const rows=await db.$queryRaw<{id:string;evidence:CalendarDay[]}[]>`SELECT id,evidence FROM "CalendarSnapshot" WHERE id=ANY(${[...new Set(ids)]}::text[])`.then(rows=>authorizeCalendarRows(db,rows));
 for(const row of rows){row.evidence.forEach(day=>Object.freeze(day));Object.freeze(row.evidence)}
 return new Map(rows.map(row=>[row.id,row.evidence]));
}
