import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshot,replay} from '../packages/indicators/dist/replay.js';
test('corrected EMA and ATR recompute identically to full history without mutating original',()=>{
 const bars=Array.from({length:35},(_,i)=>{const date=new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10);return {session:date,open:'100',high:'102',low:'98',close:'100',volume:'100',revision:'r'+i,finalizedAt:date+'T10:00:00Z',adjustmentVerified:true}});
 const original={bars,sessions:bars.map(b=>b.session),asOf:'2026-10-17T00:00:00Z',dataRevision:'before'};
 const before=snapshot(original);const corrected=structuredClone(original);corrected.dataRevision='after';corrected.bars[20].close='101';corrected.bars[20].revision='correction';
 const output=replay(corrected,20);assert.deepEqual(output.at(-1).evidence,snapshot(corrected));assert.deepEqual(snapshot(original),before);
 assert.notEqual(output.at(-1).evidence.ema21.value,before.ema21.value);
 assert.throws(()=>replay(corrected,-1));assert.throws(()=>replay(corrected,35));
});
