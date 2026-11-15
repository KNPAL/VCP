import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyNseAction} from '../scripts/nse-action-rules.mjs';
test('official bonus ratios use total shares; ambiguous capital events remain unsupported',()=>{
 assert.deepEqual(classifyNseAction('Bonus 1:2'),{kind:'BONUS',sharesBefore:'2',sharesAfter:'3'});
 assert.deepEqual(classifyNseAction('Face Value Split (Sub-Division) - From Rs10/- Per Share To Re 1/- Per Share'),{kind:'SPLIT',sharesBefore:'1',sharesAfter:'10'});
 for(const text of ['Demerger','Rights 1:9 @ Premium Rs 149/-','Scheme Of Arrangement - Bonus Ncrps 4:1','Bonus 1:0','Dividend - Rs 12.50 Per Share Pursuant To Scheme','bonus shares',''])assert.equal(classifyNseAction(text).kind,'UNSUPPORTED');
 assert.equal(classifyNseAction(' Interim Dividend - Rs 5 Per Share ').kind,'NO_SPLIT_BONUS_ADJUSTMENT');
});
