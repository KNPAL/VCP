import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {BrokerKeyResolver} from './broker-credentials.js';
/** Keys are deployment secrets in a configured directory, never database fields or queue data. */
export function directoryBrokerKeys(directory:string):BrokerKeyResolver {
 if(!directory.trim())throw new Error('BROKER_UNAVAILABLE');
 const root=resolve(directory);
 return async keyId=>{try{if(!/^[A-Za-z0-9_-]{1,64}$/.test(keyId))throw new Error();const encoded=(await readFile(join(root,keyId+'.key'),'utf8')).trim(),key=Buffer.from(encoded,'base64');if(key.length!==32||key.toString('base64')!==encoded)throw new Error();return key}catch{throw new Error('BROKER_UNAVAILABLE')}};
}
