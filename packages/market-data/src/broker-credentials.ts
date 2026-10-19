import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {utcInstant} from '@vcp/domain';
import type {BrokerSecrets} from './historical-transport.js';
export interface CredentialBinding {reference:string;accountKey:string;sessionRevision:string;keyId:string;expiresAt:string}
export interface EncryptedCredential {iv:string;tag:string;ciphertext:string}
function aad(binding:CredentialBinding){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 if(!uuid.test(binding.reference)||!uuid.test(binding.sessionRevision)||! /^[0-9a-f]{64}$/.test(binding.accountKey)||! /^[a-zA-Z0-9_-]{1,64}$/.test(binding.keyId))throw new Error('BROKER_UNAVAILABLE');
 utcInstant(binding.expiresAt);
 return Buffer.from(JSON.stringify([1,binding.reference,binding.accountKey,binding.sessionRevision,binding.keyId,binding.expiresAt]));
}
function validate(value:unknown):asserts value is BrokerSecrets {
 const keys=['accessToken','apiKey','clientLocalIp','clientPublicIp','macAddress'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|')||keys.some(key=>{const v=(value as Record<string,unknown>)[key];return typeof v!=='string'||!v.trim()||v.length>16000||/[\r\n]/.test(v)}))throw new Error('BROKER_UNAVAILABLE');
}
export function encryptBrokerCredentials(binding:CredentialBinding,secrets:BrokerSecrets,key:Buffer):EncryptedCredential {
 try{
  if(key.length!==32)throw new Error();validate(secrets);
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(binding));
  const plain=Buffer.from(JSON.stringify(secrets));
  try{return {iv:iv.toString('base64'),ciphertext:Buffer.concat([cipher.update(plain),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64')}}finally{plain.fill(0)}
 }catch{throw new Error('BROKER_UNAVAILABLE')}
}
export function decryptBrokerCredentials(binding:CredentialBinding,envelope:EncryptedCredential,key:Buffer,asOf:string):BrokerSecrets {
 try{
  if(key.length!==32||utcInstant(binding.expiresAt)<=utcInstant(asOf))throw new Error();
  const decode=(value:string)=>{if(typeof value!=='string'||value.length>120000||!value.length)throw new Error();const result=Buffer.from(value,'base64');if(result.toString('base64')!==value)throw new Error();return result};
  const iv=decode(envelope.iv),tag=decode(envelope.tag);if(iv.length!==12||tag.length!==16)throw new Error();
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(aad(binding));decipher.setAuthTag(tag);
  const plain=Buffer.concat([decipher.update(decode(envelope.ciphertext)),decipher.final()]);
  try{const value:unknown=JSON.parse(plain.toString('utf8'));validate(value);return value}finally{plain.fill(0)}
 }catch{throw new Error('BROKER_UNAVAILABLE')}
}
