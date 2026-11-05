import type {PrismaClient} from '@prisma/client';
import {claimAlert,finishAlert} from './alerts.js';
export async function readInbox(db:PrismaClient,ownerId:string){
 const [pref]=await db.$queryRaw<{browserEnabled:boolean;emailEnabled:boolean}[]>`SELECT "browserEnabled","emailEnabled" FROM "AlertChannelPreference" WHERE "ownerId"=${ownerId}::uuid`;
 const items=await db.$queryRaw<{id:string;kind:string;sourceAt:string|null;instrument:string|null;decidedAt:string;quantity:string|null;attemptedAt:Date|null;deliveredAt:Date;acknowledged:boolean;dismissed:boolean}[]>`
 SELECT i.id,coalesce(e.evidence->>'state',e.evidence->>'kind') AS kind,e.evidence->>'isin' AS instrument,
 CASE WHEN e.evidence->>'kind'='MONITOR_DEGRADED' THEN e.evidence->>'quoteSourceAt' ELSE e.evidence->>'sourceAt' END AS "sourceAt",e.evidence->>'decidedAt' AS "decidedAt",
 coalesce(e.evidence->>'quantity',e.evidence->>'openQuantity') AS quantity,
 (SELECT min(a."recordedAt") FROM "NotificationAttempt" a WHERE a."outboxId"=i.id AND a.stage='STARTED') AS "attemptedAt",
 i."createdAt" AS "deliveredAt",
 (SELECT jsonb_agg(jsonb_build_object('channel',o.channel,'state',d.state,'attempts',d.attempts,'attemptedAt',
 (SELECT max(a."recordedAt") FROM "NotificationAttempt" a WHERE a."outboxId"=o.id AND a.stage='STARTED'),
 'deliveredAt',CASE WHEN d.state='DELIVERED' THEN d."updatedAt" END) ORDER BY o.channel)
 FROM "NotificationOutbox" o JOIN "NotificationDelivery" d ON d."outboxId"=o.id
 WHERE o."ownerId"=i."ownerId" AND o."eventId"=i."eventId") AS channels,
 EXISTS(SELECT 1 FROM "AlertInboxReview" r WHERE r."inboxId"=i.id AND r.kind='ACKNOWLEDGED') AS acknowledged,
 EXISTS(SELECT 1 FROM "AlertInboxReview" r WHERE r."inboxId"=i.id AND r.kind='DISMISSED') AS dismissed
 FROM "InboxNotification" i JOIN "AlertEvent" e ON e.id=i."eventId" WHERE i."ownerId"=${ownerId}::uuid
 ORDER BY i."createdAt" DESC,i.id LIMIT 100`;
 return {preferences:pref??{browserEnabled:false,emailEnabled:false},items};
}
export async function setAlertPreference(db:PrismaClient,ownerId:string,channel:'EMAIL'|'BROWSER',enabled:boolean){
 await db.$executeRaw`INSERT INTO "AlertChannelPreference" ("ownerId","emailEnabled","browserEnabled") VALUES (${ownerId}::uuid,${channel==='EMAIL'&&enabled},${channel==='BROWSER'&&enabled})
 ON CONFLICT ("ownerId") DO UPDATE SET "emailEnabled"=CASE WHEN ${channel}='EMAIL' THEN ${enabled} ELSE "AlertChannelPreference"."emailEnabled" END,
 "browserEnabled"=CASE WHEN ${channel}='BROWSER' THEN ${enabled} ELSE "AlertChannelPreference"."browserEnabled" END`;
 return {channel,enabled};
}
export async function reviewInbox(db:PrismaClient,ownerId:string,id:string,kind:'ACKNOWLEDGED'|'DISMISSED'){
 const own=await db.inboxNotification.findFirst({where:{id,ownerId},select:{id:true}});
 if(!own)return false;
 await db.$executeRaw`INSERT INTO "AlertInboxReview" ("inboxId",kind) VALUES (${id},${kind}) ON CONFLICT DO NOTHING`;
 return true;
}
export async function browserDelivery(db:PrismaClient,ownerId:string){
 const claim=await claimAlert(db,30000,undefined,ownerId);
 return claim?{id:claim.id,token:claim.token,kind:claim.event.kind,sourceAt:claim.event.sourceAt}:null;
}
export async function finishBrowserDelivery(db:PrismaClient,ownerId:string,id:string,token:string,shown:boolean){
 const row=await db.notificationOutbox.findFirst({where:{id,ownerId,channel:'BROWSER'}});
 return !!row&&finishAlert(db,{id,token},shown);
}
