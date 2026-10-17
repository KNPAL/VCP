import {readFile} from 'node:fs/promises';
import type {TradingSession} from '@vcp/domain';
import {queue,scheduleFinalized} from './runtime.js';
const q=queue();
try{const file=process.env['VERIFIED_CALENDAR_FILE'];if(!file)throw new Error('BLOCKED_DATA: verified calendar required');const sessions=JSON.parse(await readFile(file,'utf8')) as TradingSession[];await scheduleFinalized(q,sessions,new Date().toISOString())}finally{await q.close()}
