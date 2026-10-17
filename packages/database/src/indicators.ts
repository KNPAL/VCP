import {Prisma,PrismaClient} from '@prisma/client';
import {STRATEGY_VERSION,sessionDate,utcInstant} from '@vcp/domain';
export function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
export async function persistIndicator(db:PrismaClient,input:{listingId:string;session:string;dataRevision:string;asOf:string;evidence:Prisma.InputJsonValue}) {
 sessionDate(input.session);utcInstant(input.asOf);
 const key={listingId:input.listingId,session:new Date(input.session+'T00:00:00Z'),strategyVersion:STRATEGY_VERSION,dataRevision:input.dataRevision};
 try{return await db.indicatorSnapshot.create({data:{...key,asOf:new Date(input.asOf),evidence:input.evidence}})}
 catch(e){if(!(e instanceof Prisma.PrismaClientKnownRequestError)||e.code!=='P2002')throw e;
 const prior=await db.indicatorSnapshot.findUniqueOrThrow({where:{listingId_session_strategyVersion_dataRevision:key}});
 if(canonical(prior.evidence)!==canonical(input.evidence))throw new Error('STALE_CONFLICT: different evidence for the same immutable revision');return prior;}
}
