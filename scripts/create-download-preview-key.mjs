import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const path=process.argv[2];
if(!path||process.argv.length!==3)throw new Error('Usage: node scripts/create-download-preview-key.mjs <protected-key-file>');
const key=randomBytes(32);
try{await writeFile(path,key,{flag:'wx',mode:0o600});process.stdout.write('Preview signing key created. Restrict file access to the API service account.\n')}finally{key.fill(0)}
