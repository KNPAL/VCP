import {readFile} from 'node:fs/promises';
import {PrismaClient} from '../packages/database/dist/index.js';
import {assertCalendarPermissions} from '../packages/database/dist/calendar-permissions.js';
import {verifiedCalendar} from '../packages/market-data/dist/index.js';
const id=process.argv[2];
if(!/^[a-f0-9]{64}$/.test(id??''))throw new Error('Usage: node scripts/activate-calendar.mjs <stored-calendar-id>');
const password=(await readFile('.runtime/database-password','utf8')).trim();
const db=new PrismaClient({datasources:{db:{url:`postgresql://vcp:${encodeURIComponent(password)}@127.0.0.1:55432/vcp`}}});
try {
 const calendar=await db.calendarSnapshot.findUnique({where:{id}});
 if(!calendar||!Array.isArray(calendar.evidence)||!calendar.evidence.length)throw new Error('Calendar not found');
 const days=calendar.evidence.slice().sort((a,b)=>a.date.localeCompare(b.date)),at=new Date().toISOString();
 await assertCalendarPermissions(db,days,['STORE','DERIVE','DISPLAY']);
 const from=days[0].date,to=days.at(-1).date;
 if(verifiedCalendar(days,from,to,at).state!=='KNOWN')throw new Error('Calendar has unverified dates or gaps');
 const changed=await db.$executeRaw`UPDATE "CandleCoverage" SET evidence=jsonb_set(evidence,'{planningCalendarHash}',to_jsonb(${id}::text)) WHERE provider='ANGEL_ONE'`;
 console.log(JSON.stringify({calendarId:id,from,to,days:days.length,listings:changed,pinnedJobsPreserved:true}));
}finally{await db.$disconnect()}
