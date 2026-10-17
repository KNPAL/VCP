import {createHash,randomUUID} from 'node:crypto';
import {Prisma,PrismaClient} from '@prisma/client';
import {utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';
export async function registerProfile(db:PrismaClient,version:string,configuration:Prisma.InputJsonValue){
 const id=createHash('sha256').update(canonical(configuration)).digest('hex');
 const previous=await db.strategyProfile.findUnique({where:{version}});
 if(previous){if(previous.id!==id)throw new Error('IMMUTABLE_VERSION: create a new version');return previous}
 return db.strategyProfile.create({data:{id,version,configuration}});
}
export async function activateProfile(db:PrismaClient,profileId:string,activatedAt:string,knownAt:string){
 const activation=utcInstant(activatedAt),known=utcInstant(knownAt);if(activation<known)throw new Error('BACKDATED_ACTIVATION');
 const profile=await db.strategyProfile.findUniqueOrThrow({where:{id:profileId}});if(profile.createdAt>known)throw new Error('PROFILE_NOT_YET_KNOWN');
 const id=randomUUID();await db.$executeRaw`INSERT INTO "StrategyActivation" ("id","profileId","activatedAt","knownAt") VALUES (${id}::uuid,${profileId},${activation},${known})`;
 return {id,profileId,activatedAt,knownAt};
}
export async function activeProfile(db:PrismaClient,asOf:string){
 const at=utcInstant(asOf);const rows=await db.$queryRaw<{profileId:string}[]>`SELECT "profileId" FROM "StrategyActivation" WHERE "activatedAt"<=${at} AND "knownAt"<=${at} ORDER BY "activatedAt" DESC,"knownAt" DESC,"id" DESC LIMIT 1`;
 return rows[0]?db.strategyProfile.findUnique({where:{id:rows[0].profileId}}):null;
}
