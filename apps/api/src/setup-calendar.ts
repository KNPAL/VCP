import type {CalendarDay} from '@vcp/market-data';
export const calendarRange={from:'2025-01-01',to:'2026-11-10'};
const normal='https://www.nseindia.com/static/market-data/market-timings';
const special:Record<string,{open:string;close:string;ref:string}>={
 '2025-02-01':{open:'09:15',close:'16:00',ref:'CMTR65729'},
 '2025-10-21':{open:'13:45',close:'15:05',ref:'CMTR70319'},
 '2026-02-01':{open:'09:15',close:'16:00',ref:'CMTR72349'},
 '2026-11-08':{open:'14:20',close:'16:00',ref:'CMTR76941'},
};
/** Daily ingestion envelope includes post-close/CAS; not intraday continuous-market hours. */
export function setupCalendar(holidays:{date:string;kind:string;sourceRefs:string[]}[],knownAt:string,sourceSnapshotId:string):CalendarDay[]{
 const map=new Map(holidays.map(h=>[h.date,h])),rows:CalendarDay[]=[];
 if(holidays.filter(h=>h.date.startsWith('2025')).length!==18||holidays.filter(h=>h.date.startsWith('2026')).length!==20)throw new Error('HOLIDAY_DATASET_INCOMPLETE');
 for(let date=calendarRange.from;date<=calendarRange.to;date=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
  const override=special[date],holiday=map.get(date),weekend=[0,6].includes(new Date(date+'T00:00:00Z').getUTCDay());
  if(holiday?.kind==='MUHURAT_SESSION'&&!override)throw new Error('SPECIAL_SESSION_TIMES_MISSING');
  const closed=!override&&(weekend||holiday?.kind==='CLOSED'),instant=(time:string)=>new Date(date+'T'+time+':00+05:30').toISOString();
  rows.push({date,kind:closed?'HOLIDAY':override?'SPECIAL':'TRADING',opensAt:closed?null:instant(override?.open??'09:15'),closesAt:closed?null:instant(override?.close??'16:00'),finalizedAt:closed?null:instant('16:30'),knownAt,source:override?'https://nsearchives.nseindia.com/content/circulars/'+override.ref+'.pdf':holiday?holiday.sourceRefs.map(ref=>'https://nsearchives.nseindia.com/content/circulars/'+ref+'.pdf').join(' '):normal,sourceSnapshotId,verified:true});
 }return rows;
}
