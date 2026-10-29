import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,assertCandlePermissions,persistSource} from '../packages/database/dist/index.js';
import {candlePermission} from '../fixtures/candle-permission.mjs';
test('actual candle lineage scopes rights; missing, ambiguous and expired grants block derived use',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();
 try{
  const provider='synthetic-permission-'+randomUUID(),id=randomUUID();await db.candleRevision.create({data:{id,listingId:randomUUID(),session:new Date('2026-01-01'),scale:'RAW',revision:1,open:'1',high:'1',low:'1',close:'1',volume:1n,source:provider,receivedAt:new Date(),finalizedAt:new Date('2026-01-01T10:30:00Z')}});
  await assert.rejects(assertCandlePermissions(db,[id],['DISPLAY']),/SOURCE_PERMISSION_REQUIRED/);
  await assert.rejects(assertCandlePermissions(db,[randomUUID()],['DISPLAY']),/SOURCE_LINEAGE_MISSING/);
  await assert.rejects(assertCandlePermissions(db,['not-a-revision'],['DISPLAY']),/SOURCE_LINEAGE_MISSING/);
  const grant=await candlePermission(db,provider);assert.deepEqual((await assertCandlePermissions(db,[id],['DERIVE','STORE'])).sourceSnapshotIds,[grant.id]);
  const {id:grantId,...metadata}=grant;assert.ok(grantId);await persistSource(db,{...metadata,uses:{...metadata.uses,DISPLAY:false}});
  await assert.rejects(assertCandlePermissions(db,[id],['DISPLAY']),/SOURCE_SCOPE_AMBIGUOUS/,'Equal-time conflicting grants must not be resolved by arbitrary hash order');
  const knownAt=new Date().toISOString(),denial=await persistSource(db,{...metadata,knownAt,uses:{...metadata.uses,DISPLAY:false}});
  assert.deepEqual((await assertCandlePermissions(db,[id],['DERIVE'])).sourceSnapshotIds,[denial.id]);
  await assert.rejects(assertCandlePermissions(db,[id],['DISPLAY']),/SOURCE_PERMISSION_REQUIRED/);
  await assert.rejects(assertCandlePermissions(db,[id],['DERIVE'],metadata.validUntil),/SOURCE_PERMISSION_REQUIRED/);
 }finally{await db.$disconnect()}
});
