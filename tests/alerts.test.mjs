import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAlert} from '../packages/database/dist/index.js';
const at='2026-01-01T12:00:00Z',event={id:'a'.repeat(64),sourceEventId:'b'.repeat(64),kind:'SELL',sourceAt:at,occurredAt:at,decidedAt:at,effectiveAt:at,strategyVersion:'ST_VCP_4_0',configHash:'c'.repeat(64),dataRevision:'synthetic',executable:false};
test('alert evidence preserves UTC chronology and cannot claim execution',()=>{
 validateAlert(event);assert.throws(()=>validateAlert({...event,executable:true}),/EVIDENCE/);assert.throws(()=>validateAlert({...event,kind:'ORDER_PLACED'}),/EVIDENCE/);
 assert.throws(()=>validateAlert({...event,sourceAt:'2026-01-02T12:00:00Z'}),/CHRONOLOGY/);assert.throws(()=>validateAlert({...event,effectiveAt:'2025-12-31T12:00:00Z'}),/CHRONOLOGY/);
 assert.throws(()=>validateAlert({...event,decidedAt:'2099-01-01T12:00:00Z',effectiveAt:'2099-01-01T12:00:00Z'}),/CHRONOLOGY/);
});
