import test from 'node:test';
import assert from 'node:assert/strict';
import {Q} from '../packages/indicators/dist/rational.js';
test('cross-cancelled rational arithmetic matches independently reduced products and sums',()=>{
 for(const a of [-10001,-17,-1,0,1,13,10001])for(const b of [1,2,14,100,99991]){
  const x=new Q(a,b),y=new Q(b-3,a||1);
  for(const [actual,expected] of [[x.add(y),new Q(x.n*y.d+y.n*x.d,x.d*y.d)],[x.sub(y),new Q(x.n*y.d-y.n*x.d,x.d*y.d)],[x.mul(y),new Q(x.n*y.n,x.d*y.d)],[x.div(y),new Q(x.n*y.d,x.d*y.n)]]){
   assert.equal(actual.n,expected.n);assert.equal(actual.d,expected.d);assert.equal(actual.fixed(),expected.fixed());assert.ok(actual instanceof Q);
  }
 }
 const huge=new Q(13n**310n+1n,14n**310n),other=new Q(-5n,7n);
 assert.deepEqual(huge.add(other),new Q(huge.n*other.d+other.n*huge.d,huge.d*other.d));
 assert.deepEqual(huge.mul(other),new Q(huge.n*other.n,huge.d*other.d));
 assert.throws(()=>huge.div(new Q(0)),/ZERO_DENOMINATOR/);
});
