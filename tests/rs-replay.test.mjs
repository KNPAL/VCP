import test from 'node:test';
import assert from 'node:assert/strict';
import {replayRelativeStrength} from '../packages/indicators/dist/index.js';
const sessions=Array.from({length:252},(_,i)=>new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10));
function series(slope=0){return {sessions,asOf:'2026-10-18T00:00:00Z',dataRevision:'synthetic-'+slope,bars:sessions.map((session,i)=>({session,open:String(100+i*slope),high:String(101+i*slope),low:String(99+i*slope),close:String(100+i*slope),volume:'100',revision:'synthetic-'+slope+'-'+i,finalizedAt:session+'T10:30:00Z',adjustmentVerified:true}))}}
test('historical RS uses per-session prefixes, exact ties and full intended denominator',()=>{
 const input={benchmark:series(),members:{A:series(),B:series(1),C:series(1),D:series(2),E:null},intended:['A','B','C','D','E'],sessions};
 const result=replayRelativeStrength(input),last=result.at(-1);
 assert.equal(result[249].state,'UNKNOWN');assert.equal(result[250].state,'KNOWN');
 assert.deepEqual(last.values,{A:'12.50000000',B:'50.00000000',C:'50.00000000',D:'87.50000000',E:null});
 assert.equal(last.comparable,4);assert.equal(last.intended,5);
 const fewer=replayRelativeStrength({...input,members:{...input.members,D:null}});assert.equal(fewer.at(-1).state,'UNKNOWN');
 const changed=structuredClone(input);changed.members.B.bars.at(-1).close='352';
 assert.deepEqual(replayRelativeStrength(changed).slice(0,-1),result.slice(0,-1));
 assert.notDeepEqual(replayRelativeStrength(changed).at(-1).values,last.values);
});
test('missing benchmark bars and future-finalized member bars never produce known percentiles',()=>{
 const input={benchmark:series(),members:{A:series()},intended:['A'],sessions};
 assert.equal(replayRelativeStrength({...input,benchmark:{...input.benchmark,bars:input.benchmark.bars.slice(1)}}).at(-1).state,'UNKNOWN');
 input.members.A.bars.at(-1).finalizedAt='2027-01-01T00:00:00Z';assert.equal(replayRelativeStrength(input).at(-1).state,'UNKNOWN');
});
