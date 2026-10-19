import test from 'node:test';
import assert from 'node:assert/strict';
import {backfillHorizon,missingWindows,splitBackfillWindow,calendarDays,planBackfill,dateAfter} from '../packages/market-data/dist/index.js';
test('backfill horizon and request segmentation respect five years, leap dates and 400 calendar days',()=>{
 assert.deepEqual(backfillHorizon('2024-02-29'),{from:'2019-02-28',to:'2024-02-29'});
 const dates=Array.from({length:900},(_,i)=>dateAfter('2022-01-01',i));
 const windows=missingWindows(dates,[]);assert.equal(windows.length,3);assert.ok(windows.every(w=>calendarDays(w.from,w.to)<=400));assert.deepEqual(windows.flatMap(w=>w.sessions),dates);
 const gaps=missingWindows(dates,dates.filter((_,i)=>i!==5&&i!==50));assert.deepEqual(gaps.flatMap(w=>w.sessions),[dates[5],dates[50]]);
});
test('truncated ranges shrink to seven days without losing odd-day gaps',()=>{
 for(const days of [8,13,14,15,400]){const sessions=Array.from({length:days},(_,i)=>dateAfter('2025-01-01',i));const children=splitBackfillWindow({from:sessions[0],to:sessions.at(-1),sessions},sessions);assert.ok(children.every(w=>calendarDays(w.from,w.to)>=7&&calendarDays(w.from,w.to)<days));assert.deepEqual([...new Set(children.flatMap(w=>w.sessions))].sort(),sessions)}
 const sessions=Array.from({length:7},(_,i)=>dateAfter('2025-01-01',i));assert.deepEqual(splitBackfillWindow({from:sessions[0],to:sessions.at(-1),sessions},sessions),[]);
});
test('unknown calendars cannot queue a backfill and short verified listing histories remain explicit',()=>{
 const to='2026-10-16',asOf='2026-10-18T12:00:00Z';
 assert.equal(planBackfill({to,asOf,calendar:null,storedSessions:[]}).state,'UNKNOWN');
 const day={date:to,kind:'SPECIAL',opensAt:to+'T03:45:00Z',closesAt:to+'T10:00:00Z',finalizedAt:to+'T10:30:00Z',knownAt:'2026-01-01T00:00:00Z',source:'synthetic',verified:true};
 const result=planBackfill({to,asOf,calendar:[day],storedSessions:[],availableFrom:to});assert.equal(result.historyState,'INSUFFICIENT_AVAILABLE_HISTORY');assert.equal(result.targetSessions,450);assert.equal(result.windows.length,1);
});
