import {spawn} from 'node:child_process';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {hashPassword} from '../packages/database/dist/password.js';

const fixture=await isolatedDatabase('broker_ui',{seedOwner:false});
try {
 await fixture.db.owner.create({data:{login:'integration-owner',passwordHash:await hashPassword('synthetic-test-password-2026')}});
 const url=new URL(process.env.DATABASE_URL);
 const [schema]=await fixture.db.$queryRaw`SELECT current_schema() AS name`;
 url.searchParams.set('schema',schema.name);
 const child=spawn(process.execPath,['scripts/ci-web-test.mjs'],{stdio:'inherit',env:{
  ...process.env,DATABASE_URL:url.toString(),VCP_OPERATIONS_TEST:'true',VCP_DOWNLOAD_PREVIEW_TEST:'true',VCP_BROKER_CONNECTION_TEST:'true'
 }});
 process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1))});
} finally {await fixture.close()}
