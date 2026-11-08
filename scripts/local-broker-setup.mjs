import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
/** Local development only. Existing encryption keys are never replaced. */
export async function prepareLocalBroker(){
 await mkdir('.runtime/broker-keys',{recursive:true});
 const files=[['.runtime/broker-configuration.key',false],['.runtime/broker-keys/local-v1.key',true],['.runtime/download-preview.key',false]];
 for(const [file,base64] of files){
  const key=randomBytes(32);
  try{await writeFile(file,base64?key.toString('base64'):key,{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}finally{key.fill(0)}
  const stored=await readFile(file),decoded=base64?Buffer.from(stored.toString().trim(),'base64'):stored;
  try{if(decoded.length!==32)throw new Error('Existing local broker key is invalid; restore the original key instead of replacing it.')}finally{decoded.fill(0);stored.fill(0)}
 }
 return {VCP_BROKER_CONFIGURATION_KEY_FILE:resolve('.runtime/broker-configuration.key'),BROKER_KEY_DIRECTORY:resolve('.runtime/broker-keys'),VCP_BROKER_SESSION_KEY_ID:'local-v1',VCP_DOWNLOAD_PREVIEW_KEY_FILE:resolve('.runtime/download-preview.key'),VCP_ENABLE_MANUAL_DOWNLOADS:'true'};
}
