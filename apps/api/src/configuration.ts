import {readFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {readBrokerNetwork,validateBrokerNetwork,directoryBrokerKeys,type PrismaClient} from '@vcp/database';
import {brokerTransportAllowed,type BrokerRequest} from './broker-transport.js';
export async function configurationStatus(db:PrismaClient,ownerId:string,request:BrokerRequest,origin:string){
 const stored=await readBrokerNetwork(db,ownerId);
 let configurationKeyReady=false,sessionKeyReady=false,network=stored?.network??null;
 try{const key=await readFile(process.env['VCP_BROKER_CONFIGURATION_KEY_FILE']??'');configurationKeyReady=key.length===32;key.fill(0)}catch{/* Report setup state without paths or secrets. */}
 try{const key=await directoryBrokerKeys(process.env['BROKER_KEY_DIRECTORY']??'')(process.env['VCP_BROKER_SESSION_KEY_ID']??'');sessionKeyReady=key.length===32;key.fill(0)}catch{/* Report setup state without paths or secrets. */}
 if(!stored&&process.env['VCP_BROKER_NETWORK_FILE'])try{network=validateBrokerNetwork(JSON.parse(await readFile(process.env['VCP_BROKER_NETWORK_FILE'],'utf8')))}catch{/* Invalid legacy config remains unavailable. */}
 const local=Object.values(networkInterfaces()).flat().find(row=>row&&!row.internal&&row.family==='IPv4'&&row.mac!=='00:00:00:00:00:00');
 return {revision:stored?.revision??'none',network,source:stored?'DATABASE':network?'SERVER_FILE':'NOT_CONFIGURED',runtime:{transportAllowed:brokerTransportAllowed(request,origin),configurationKeyReady,sessionKeyReady,liveEnabled:process.env['VCP_ENABLE_LIVE_STREAM']==='true'},suggestedNetwork:{clientLocalIp:local?.address??'',macAddress:local?.mac??''}};
}
