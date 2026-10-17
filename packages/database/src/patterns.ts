import {Prisma,PrismaClient} from '@prisma/client';
import {canonical} from './indicators.js';
export async function persistPattern(db:PrismaClient,input:{patternId:string;listingId:string;session:string;dataRevision:string;adjustmentRevision:string;asOf:string;decidedAt:string;evidence:Prisma.InputJsonValue}){
 const data={...input,session:new Date(input.session+'T00:00:00Z'),asOf:new Date(input.asOf),decidedAt:new Date(input.decidedAt)};
 try{return await db.patternSnapshot.create({data})}catch(e){if(!(e instanceof Prisma.PrismaClientKnownRequestError)||e.code!=='P2002')throw e;const prior=await db.patternSnapshot.findUniqueOrThrow({where:{patternId_session_dataRevision:{patternId:input.patternId,session:data.session,dataRevision:input.dataRevision}}});if(canonical(prior.evidence)!==canonical(input.evidence))throw new Error('STALE_CONFLICT',{cause:e});return prior;}
}
export async function supersedePattern(db:PrismaClient,oldId:string,replacedById:string){
 if(oldId===replacedById)throw new Error('INVALID_SUPERSESSION');
 return db.$transaction(async tx=>{
 const prior=await tx.patternReplacement.findUnique({where:{oldId}});
 if(prior){if(prior.replacedById!==replacedById)throw new Error('STALE_CONFLICT');return prior}
 const [old,next,alreadyReplaced]=await Promise.all([tx.patternSnapshot.findFirst({where:{patternId:oldId}}),tx.patternSnapshot.findFirst({where:{patternId:replacedById}}),tx.patternReplacement.findUnique({where:{oldId:replacedById}})]);
 if(!old||!next||alreadyReplaced||old.listingId!==next.listingId||old.adjustmentRevision===next.adjustmentRevision)throw new Error('INVALID_SUPERSESSION');
 const anchor=(e:Prisma.JsonValue)=>{if(typeof e!=='object'||e===null||Array.isArray(e))return '';const a=e['anchor'];return typeof a==='object'&&a!==null&&!Array.isArray(a)&&typeof a['occurredAt']==='string'?a['occurredAt']:''};
 if(!anchor(old.evidence)||anchor(old.evidence)!==anchor(next.evidence))throw new Error('INVALID_SUPERSESSION_ANCHOR');
 return tx.patternReplacement.create({data:{oldId,replacedById,reason:'ADJUSTMENT_REVISION_CHANGED'}});
 },{isolationLevel:'Serializable'});
}


