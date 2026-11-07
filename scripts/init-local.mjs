import {prepareLocalBroker} from './local-broker-setup.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
await mkdir('.runtime', {recursive:true});
for (const name of ['database-password','owner-password']) {
 try { await writeFile('.runtime/'+name, randomBytes(24).toString('hex'), {flag:'wx',mode:0o600}); }
 catch(error) { if(error.code !== 'EEXIST') throw error; }
}
await prepareLocalBroker();
console.log('Local secret files prepared in .runtime. Existing secrets preserved.');
