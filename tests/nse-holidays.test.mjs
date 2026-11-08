import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateHolidayData} from '../scripts/nse-holiday-data.mjs';
const data=JSON.parse(await readFile(new URL('../data/nse-cm-holidays-2015-2026.json',import.meta.url),'utf8'));
test('NSE annual holidays include all years, amendments and distinct Muhurat sessions',()=>{
 assert.match(validateHolidayData(data),/^[a-f0-9]{64}$/);
 assert.equal(data.holidays.length,231);
 assert.equal(data.holidays.filter(row=>row.kind==='MUHURAT_SESSION').length,12);
 const find=date=>data.holidays.find(row=>row.date===date);
 assert.equal(find('2023-06-28'),undefined);
 assert.equal(find('2023-06-29').supersedesDate,'2023-06-28');
 for(const date of ['2019-04-29','2019-10-21','2024-01-22','2024-05-20','2024-11-20','2026-01-15'])assert.equal(find(date).kind,'CLOSED');
 assert.equal(find('2026-11-08').kind,'MUHURAT_SESSION');
 assert.equal(find('2017-04-14').name.includes('Ambedkar'),true);
 assert.equal(find('2022-04-14').name.includes('Mahavir'),true);
});
test('holiday import rejects duplicate dates, wrong weekdays and unofficial provenance',()=>{
 const duplicate=structuredClone(data);duplicate.holidays.push(duplicate.holidays[0]);assert.throws(()=>validateHolidayData(duplicate),/duplicate/);
 const weekday=structuredClone(data);weekday.holidays[0].weekend=!weekday.holidays[0].weekend;assert.throws(()=>validateHolidayData(weekday),/classification/);
 const source=structuredClone(data);source.sources.CMTR28337.url='https://example.com/holidays.pdf';assert.throws(()=>validateHolidayData(source),/source/);
});
