import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ST_VCP_4_0,configurationHash} from '../packages/strategy/dist/index.js';
test('immutable profile hashes ignore JSON ordering but reflect all thresholds',()=>{
 assert.equal(configurationHash({a:1,b:'2'}),configurationHash({b:'2',a:1}));
 assert.notEqual(configurationHash(ST_VCP_4_0),configurationHash({...ST_VCP_4_0,maximumStop:'0.09'}));
 assert.throws(()=>{ST_VCP_4_0.maximumStop='0.09'});assert.throws(()=>configurationHash({a:NaN}));
 assert.equal(ST_VCP_4_0.automaticOrders,false);
});
