import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const manifest=JSON.parse(await readFile(new URL('../fixtures/historical-golden-manifest.json',import.meta.url),'utf8'));
const files=[...new Set(['tests/backtest-manifest.test.mjs','tests/walk-forward.test.mjs','tests/paper-performance.test.mjs',...manifest.cases.flatMap(row=>row.tests)])];
const result=spawnSync(process.execPath,['--test',...files],{cwd:new URL('..',import.meta.url),stdio:'inherit',shell:false});
if(result.error)throw result.error;
process.exitCode=result.status??1;
