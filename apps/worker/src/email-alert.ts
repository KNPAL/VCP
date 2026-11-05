import {readFile} from 'node:fs/promises';
import type {AlertDelivery,PrismaClient} from '@vcp/database';

export function emailAdapter(db:PrismaClient, env=process.env, transport=fetch){
 return async (claim:AlertDelivery)=>{
  const recipient=env['VCP_ALERT_EMAIL_TO'], sender=env['VCP_ALERT_EMAIL_FROM'], file=env['VCP_ALERT_EMAIL_KEY_FILE'];
  if(claim.channel!=='EMAIL'||claim.ownerId!==env['VCP_ALERT_EMAIL_OWNER']||!file||!recipient||!sender)throw new Error('EMAIL_UNCONFIGURED');
  const [eligible]=await db.$queryRaw<{allowed:boolean}[]>`SELECT p."emailEnabled" AND min(a."recordedAt") > clock_timestamp()-interval '23 hours' AS allowed
   FROM "AlertChannelPreference" p JOIN "NotificationAttempt" a ON a."outboxId"=${claim.id}
   WHERE p."ownerId"=${claim.ownerId}::uuid AND a.stage='STARTED' GROUP BY p."emailEnabled"`;
  if(!eligible?.allowed)throw new Error('EMAIL_DISABLED_OR_EXPIRED');
  const key=(await readFile(file,'utf8')).trim();
  if(!key)throw new Error('EMAIL_UNCONFIGURED');
  const result=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
   headers:{authorization:'Bearer '+key,'content-type':'application/json','Idempotency-Key':claim.id},
   body:JSON.stringify({from:sender,to:[recipient],subject:'Study Trade: '+claim.event.kind,text:'Source time: '+claim.event.sourceAt+'\nOpen your Study Trade inbox to review this alert.'})});
  if(!result.ok||typeof (await result.json()).id!=='string')throw new Error('EMAIL_PROVIDER_UNCONFIRMED');
 };
}
