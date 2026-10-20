import {createHash,randomUUID} from 'node:crypto';
import {Prisma,PrismaClient} from '@prisma/client';
import {utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';
import {ST_VCP_4_0,PROFILE_VERSION,configurationHash} from '@vcp/strategy';
export async function registerProfile(db:PrismaClient,version:string,configuration:Prisma.InputJsonValue){
 const id=createHash('sha256').update(canonical(configuration)).digest('hex');
 const previous=await db.strategyProfile.findUnique({where:{version}});
 if(previous){if(previous.id!==id)throw new Error('IMMUTABLE_VERSION: create a new version');return previous}
 try{return await db.strategyProfile.create({data:{id,version,configuration}})}catch(error){
  if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'){
   const saved=await db.strategyProfile.findUnique({where:{version}});if(saved?.id===id)return saved;
   throw new Error('IMMUTABLE_VERSION: create a new version',{cause:error});
  }throw error;
 }
}
export function validateProfileVersion(version:unknown,configuration:unknown){
 if(typeof version!=='string'||!/^ST_VCP_[A-Z0-9_]{1,64}$/.test(version)||!configuration||typeof configuration!=='object'||Array.isArray(configuration))throw new Error('INVALID_PROFILE_VERSION');
 const row=configuration as Record<string,unknown>,keys=Object.keys(ST_VCP_4_0);
 if(Object.keys(row).length!==keys.length||Object.keys(row).some(k=>!keys.includes(k)))throw new Error('INVALID_CONFIGURATION_FIELDS');
 for(const [key,base] of Object.entries(ST_VCP_4_0)){
  const value=row[key];if(typeof value!==typeof base)throw new Error('INVALID_CONFIGURATION_VALUE');
  if(typeof base==='number'&&(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>10000))throw new Error('INVALID_CONFIGURATION_VALUE');
  if(typeof base==='string'&&!['version','algorithm'].includes(key)&&(typeof value!=='string'||!/^\d{1,12}(\.\d{1,8})?$/.test(value)))throw new Error('INVALID_CONFIGURATION_VALUE');
 }
 if(row['automaticOrders']!==false||row['automaticAddSignal']!==false||row['algorithm']!==ST_VCP_4_0.algorithm||row['configurationRevision']!==ST_VCP_4_0.configurationRevision)throw new Error('UNSUPPORTED_CONFIGURATION_AUTHORITY');
 if(row['version']!==(version===PROFILE_VERSION?ST_VCP_4_0.version:version))throw new Error('PROFILE_VERSION_MISMATCH');
 if(version===PROFILE_VERSION&&configurationHash(row)!==configurationHash(ST_VCP_4_0))throw new Error('IMMUTABLE_DEFAULT_PROFILE');
 return {version,configuration:row as Prisma.InputJsonObject};
}
export async function readProfileHistory(db:PrismaClient){
 const asOf=new Date().toISOString(),active=await activeProfile(db,asOf),items=await db.strategyProfile.findMany({orderBy:[{createdAt:'desc'},{id:'asc'}]});
 const activations=await db.$queryRaw<{id:string;profileId:string;activatedAt:Date;knownAt:Date}[]>`SELECT "id","profileId","activatedAt","knownAt" FROM "StrategyActivation" ORDER BY "activatedAt" DESC,"id"`;
 return {asOf,activeId:active?.id??null,defaultVersion:PROFILE_VERSION,defaultConfiguration:ST_VCP_4_0,executionSupportedHash:configurationHash(ST_VCP_4_0),items:items.map(p=>({...p,executionSupported:p.id===configurationHash(ST_VCP_4_0)})),activations,sourceFreshness:'UNKNOWN',trailingContract:{emaSessions:21,atrMultiplier:'0.5',effective:'NEXT_SESSION'}};
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
