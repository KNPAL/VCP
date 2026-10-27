import type {PrismaClient} from '@prisma/client';
/** Internal quote routing. Saved configuration always overrides legacy environment routing. */
export async function ownerStreamBinding(db:Pick<PrismaClient,'$queryRaw'>,ownerId:string,legacyAccount?:string,legacyOwner?:string){
 const rows=await db.$queryRaw<{accountKey:string;revision:string;sessionRevision:string|null;ready:boolean}[]>`SELECT b."accountKey",b."revision",c."sessionRevision",COALESCE(NOT c."open" AND c."verifiedAt">b."updatedAt" AND c."verifiedAt"<=clock_timestamp() AND c."expiresAt">clock_timestamp() AND EXISTS(SELECT 1 FROM "BrokerCredential" s WHERE s."accountKey"=c."accountKey" AND s."sessionRevision"=c."sessionRevision" AND s."expiresAt"=c."expiresAt"),false) AS ready FROM "BrokerConfiguration" b LEFT JOIN "BrokerCircuit" c ON c."accountKey"=b."accountKey" WHERE b."ownerId"=${ownerId}::uuid`;
 const row=rows[0];if(row)return {accountKey:row.ready?row.accountKey:undefined,name:row.ready?'smartapi-'+row.accountKey:undefined,revision:row.revision,sessionRevision:row.ready?row.sessionRevision:null};
 if(legacyAccount&&!/^[a-f0-9]{64}$/.test(legacyAccount))throw new Error('INVALID_STREAM_ACCOUNT');
 return {accountKey:legacyAccount,name:legacyAccount?'smartapi-'+legacyAccount:legacyOwner,revision:null,sessionRevision:null};
}
