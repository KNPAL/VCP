import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {PrismaClient} from '../packages/database/dist/index.js';
export async function isolatedDatabase(prefix,{seedOwner=true}={}){
 assert.match(prefix,/^[a-z_]+$/);const url=new URL(process.env.DATABASE_URL);assert.equal(url.pathname,'/vcp_test');
 const schema=prefix+'_'+randomUUID().replaceAll('-','');assert.match(schema,/^[a-z_]+_[a-f0-9]{32}$/);
 const admin=new PrismaClient();let db;
 const close=async()=>{await db?.$disconnect();await admin.$executeRawUnsafe('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await admin.$disconnect()};
 try{
  await admin.$executeRawUnsafe('CREATE SCHEMA "'+schema+'"');url.searchParams.set('schema',schema);
  const migration=spawnSync(process.execPath,['packages/database/node_modules/prisma/build/index.js','migrate','deploy','--schema','packages/database/prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:url.toString()},encoding:'utf8',timeout:120000});assert.equal(migration.status,0,'Isolated schema migrations must succeed');
  db=new PrismaClient({datasources:{db:{url:url.toString()}}});assert.equal((await db.$queryRaw`SELECT current_schema() AS name`)[0].name,schema);
  if(seedOwner)await db.owner.create({data:{login:'synthetic-'+prefix,passwordHash:'not-used-for-authentication'}});
  return {db,close};
 }catch(error){await close();throw error}
}
