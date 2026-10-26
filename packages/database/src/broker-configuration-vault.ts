import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
export type BrokerConfigurationInput={apiKey:string;clientCode:string};
export type ConfigurationEnvelope={iv:string;tag:string;ciphertext:string};
export function validateBrokerConfiguration(value:unknown):BrokerConfigurationInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_BROKER_CONFIGURATION');
 const data=value as BrokerConfigurationInput;
 if(Object.keys(data).sort().join('|')!=='apiKey|clientCode'||typeof data.apiKey!=='string'||! /^[A-Za-z0-9_-]{8,256}$/.test(data.apiKey)||typeof data.clientCode!=='string'||! /^[A-Za-z0-9]{3,32}$/.test(data.clientCode))throw new Error('INVALID_BROKER_CONFIGURATION');
 return {apiKey:data.apiKey,clientCode:data.clientCode.toUpperCase()};
}
function aad(ownerId:string,revision:string){const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;if(!uuid.test(ownerId)||!uuid.test(revision))throw new Error('BROKER_CONFIGURATION_UNAVAILABLE');return Buffer.from(JSON.stringify(['ANGEL_ONE_CONFIGURATION',1,ownerId,revision]))}
function validKey(key:Buffer){if(key.length!==32)throw new Error('BROKER_CONFIGURATION_UNAVAILABLE')}
export function configurationFingerprint(ownerId:string,input:BrokerConfigurationInput,key:Buffer){validKey(key);return createHmac('sha256',key).update(JSON.stringify(['ANGEL_ONE_CONFIGURATION',ownerId,validateBrokerConfiguration(input)])).digest('hex')}
export function encryptBrokerConfiguration(ownerId:string,revision:string,input:BrokerConfigurationInput,key:Buffer):ConfigurationEnvelope{
 validKey(key);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),plain=Buffer.from(JSON.stringify(validateBrokerConfiguration(input)));cipher.setAAD(aad(ownerId,revision));
 try{const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}}finally{plain.fill(0)}
}
/** Server authentication adapter only. Never return this value from a public endpoint. */
export function decryptBrokerConfiguration(ownerId:string,revision:string,envelope:ConfigurationEnvelope,key:Buffer):BrokerConfigurationInput{
 try{validKey(key);const decode=(v:string)=>{if(typeof v!=='string'||!v.length||v.length>4096)throw new Error();const b=Buffer.from(v,'base64');if(b.toString('base64')!==v)throw new Error();return b},iv=decode(envelope.iv),tag=decode(envelope.tag);if(iv.length!==12||tag.length!==16)throw new Error();const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(aad(ownerId,revision));decipher.setAuthTag(tag);const plain=Buffer.concat([decipher.update(decode(envelope.ciphertext)),decipher.final()]);try{return validateBrokerConfiguration(JSON.parse(plain.toString('utf8')))}finally{plain.fill(0)}}catch{throw new Error('BROKER_CONFIGURATION_UNAVAILABLE')}
}
