import {randomUUID,createHash} from 'node:crypto';
import {candlePermission} from './candle-permission.mjs';
export async function signalLineage(db,event){
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),provider='synthetic-signal-'+randomUUID(),grant=await candlePermission(db,provider),currentGrant=await candlePermission(db,provider+'-current'),ids=[randomUUID(),randomUUID()],previousId=hash(randomUUID());
 event.sourceRevisions=[ids[1]];
 const rows=[],executionIds=[];
 for(const [index,session] of [event.previousSnapshot.session,event.session].entries()){
  const bar={session,revision:ids[index],open:'100',high:'102',low:'94',close:'101',volume:'100',endedAt:session+'T10:00:00Z',finalizedAt:session+'T10:30:00Z'};
  await db.candleRevision.create({data:{id:bar.revision,listingId:event.listingId,session:new Date(session),scale:'RAW',revision:1,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:100n,source:index?currentGrant.provider:grant.provider,receivedAt:new Date(event.decidedAt),finalizedAt:new Date(bar.finalizedAt)}});
  rows.push(bar);
  const id=index?hash(randomUUID()):previousId,evidence={id,input:{listingId:event.listingId,scaleRevision:hash([]),series:{bars:[bar],dataRevision:index?event.dataRevision:event.previousSnapshot.dataRevision}},previousId:index?previousId:null,breakout:{event:index?event:null},detector:{frozen:{primary:null}}};
  executionIds.push(id);
  await db.$executeRaw`INSERT INTO "DailyStructureExecution" ("id","listingId","session","configHash","evidence") VALUES (${id},${event.listingId}::uuid,${new Date(session)},${event.configHash},${JSON.stringify(evidence)}::jsonb)`;
 }
 return {grant,currentGrant,rows,executionIds};
}
