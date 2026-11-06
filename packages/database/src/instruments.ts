import {PrismaClient,type Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {validateInstrumentSnapshot,canonicalListings,universeAt,sectorAt,sourcePermission,type Permission,type SourceRecord,type InstrumentSnapshot,type UniverseSnapshot,type SectorMapping} from '@vcp/market-data';
import {registeredSourceReasons,lockSourceScope} from './source-authority.js';
import {utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';
const hash=(data:unknown)=>createHash('sha256').update(canonical(data)).digest('hex');
export async function persistInstrumentSnapshot(db:PrismaClient,input:Omit<InstrumentSnapshot,'id'>){
 return db.$transaction(tx=>persistInstrumentSnapshotTransaction(tx,input));
}
export async function persistInstrumentSnapshotTransaction(tx:Prisma.TransactionClient,input:Omit<InstrumentSnapshot,'id'>){
 const normalized={...input,rows:[...input.rows].sort((a,b)=>a.listingId.localeCompare(b.listingId)||a.provider.localeCompare(b.provider)||a.validFrom.localeCompare(b.validFrom))};
 const snapshot={...normalized,id:hash(normalized)};validateInstrumentSnapshot(snapshot);
 const source=input.source;
 if(!source||source.dataset!=='instrument-master'||sourcePermission(source,'STORE',input.knownAt).status!=='PASS')throw new Error('INSTRUMENT_STORAGE_PERMISSION_REQUIRED');
 await lockSourceScope(tx,source);
 if((await registeredSourceReasons(tx,source,['STORE'],new Date().toISOString())).length)throw new Error('INSTRUMENT_STORAGE_PERMISSION_REQUIRED');
  const json=canonical(snapshot);await tx.$executeRaw`INSERT INTO "InstrumentSnapshot" ("id","knownAt","sourceReference","evidence") VALUES (${snapshot.id},${utcInstant(snapshot.knownAt)},${snapshot.sourceReference},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;
  // Batch transport keeps full-universe imports inside the transaction deadline.
  // Check every requested identity after insertion, including conflicting duplicates.
  const records=canonical(snapshot.rows);
  await tx.$executeRaw`INSERT INTO "Company" (id,isin)
   SELECT (r->>'companyId')::uuid,r->>'isin' FROM jsonb_array_elements(${records}::jsonb) r ON CONFLICT DO NOTHING`;
  const companies=await tx.$queryRaw<{id:string;isin:string}[]>`SELECT id,isin FROM "Company" WHERE id=ANY(${snapshot.rows.map(r=>r.companyId)}::uuid[])`;
  const byCompany=new Map(companies.map(c=>[c.id,c.isin]));
  if(snapshot.rows.some(r=>byCompany.get(r.companyId)!==r.isin))throw new Error('COMPANY_IDENTITY_CONFLICT');
  await tx.$executeRaw`INSERT INTO "Listing" (id,"companyId",exchange)
   SELECT (r->>'listingId')::uuid,(r->>'companyId')::uuid,r->>'exchange' FROM jsonb_array_elements(${records}::jsonb) r ON CONFLICT DO NOTHING`;
  const listings=await tx.$queryRaw<{id:string;companyId:string;exchange:string}[]>`SELECT id,"companyId",exchange FROM "Listing" WHERE id=ANY(${snapshot.rows.map(r=>r.listingId)}::uuid[])`;
  const byListing=new Map(listings.map(l=>[l.id,l]));
  if(snapshot.rows.some(r=>byListing.get(r.listingId)?.companyId!==r.companyId||byListing.get(r.listingId)?.exchange!==r.exchange))throw new Error('LISTING_IDENTITY_CONFLICT');
  const mappings=canonical(snapshot.rows.map(row=>({id:hash([snapshot.id,row]),row})));
  await tx.$executeRaw`INSERT INTO "ListingMapping" (id,"snapshotId","listingId",provider,token,"validFrom","validTo",evidence)
   SELECT m->>'id',${snapshot.id},(m->'row'->>'listingId')::uuid,m->'row'->>'provider',m->'row'->>'token',
    (m->'row'->>'validFrom')::date,(m->'row'->>'validTo')::date,m->'row'
   FROM jsonb_array_elements(${mappings}::jsonb) m ON CONFLICT (id) DO NOTHING`;
  return snapshot;
}
/** Retain the selected snapshot identity while withholding unauthorized mappings;
 * never fall back to an older master after revocation. */
export async function authorizeInstrumentRows<T extends {evidence:InstrumentSnapshot}>(db:Pick<PrismaClient,'$queryRaw'>,rows:readonly T[]):Promise<T[]>{
 const result:T[]=[];
 for(const row of rows){
  const source=row.evidence.source,allowed=!!source&&source.dataset==='instrument-master'&&!(await registeredSourceReasons(db,source,['DERIVE','DISPLAY'],new Date().toISOString())).length;
  result.push(allowed?row:{...row,evidence:{...row.evidence,rows:[]}});
 }return result;
}
export async function assertInstrumentPermission(db:Pick<PrismaClient,'$queryRaw'>,id:string,uses:readonly Permission[]){
 const [row]=await db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT evidence FROM "InstrumentSnapshot" WHERE id=${id}`;
 const source=row?.evidence.source;
 if(!source||source.dataset!=='instrument-master'||(await registeredSourceReasons(db,source,uses,new Date().toISOString())).length)throw new Error('SOURCE_PERMISSION_REQUIRED');
}
export async function persistUniverse(db:PrismaClient,input:Omit<UniverseSnapshot,'id'>){
 const normalized={...input,isins:[...input.isins].sort()},snapshot={...normalized,id:hash(normalized)};universeAt([snapshot],snapshot.knownAt);
 const source=input.source;
 if(!source||source.dataset!=='UNIVERSE'||sourcePermission(source,'STORE',input.knownAt).status!=='PASS')throw new Error('UNIVERSE_STORAGE_PERMISSION_REQUIRED');
 const json=canonical(snapshot);
 await db.$transaction(async tx=>{
  await lockSourceScope(tx,source);
  if((await registeredSourceReasons(tx,source,['STORE'],new Date().toISOString())).length)throw new Error('UNIVERSE_STORAGE_PERMISSION_REQUIRED');
  await tx.$executeRaw`INSERT INTO "UniverseSnapshot" ("id","knownAt","evidence") VALUES (${snapshot.id},${utcInstant(snapshot.knownAt)},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;
 });return snapshot;
}
export async function assertUniversePermission(db:Pick<PrismaClient,'$queryRaw'>,id:string,uses:readonly Permission[]){
 const [row]=await db.$queryRaw<{evidence:UniverseSnapshot}[]>`SELECT evidence FROM "UniverseSnapshot" WHERE id=${id}`;
 const source=row?.evidence.source;
 if(!source||source.dataset!=='UNIVERSE'||(await registeredSourceReasons(db,source,uses,new Date().toISOString())).length)throw new Error('SOURCE_PERMISSION_REQUIRED');
}
export async function authorizedUniverseAt(db:Pick<PrismaClient,'$queryRaw'>,snapshots:readonly UniverseSnapshot[],asOf:string){
 const result=universeAt(snapshots,asOf);if(!result.snapshotId)return result;
 try{await assertUniversePermission(db,result.snapshotId,['DERIVE','DISPLAY'])}catch(error){if(!(error instanceof Error)||error.message!=='SOURCE_PERMISSION_REQUIRED')throw error;return {...result,state:'UNKNOWN' as const,members:[],snapshotId:null,reason:'UNIVERSE_SOURCE_NOT_PERMITTED'}}
 return result;
}
export async function pinScanUniverse(db:PrismaClient,scanId:string,asOf:string){
 return db.$transaction(async tx=>{
  const universes=await tx.$queryRaw<{evidence:UniverseSnapshot}[]>`SELECT "evidence" FROM "UniverseSnapshot" WHERE "knownAt"<=${utcInstant(asOf)}`;
  const instruments=await tx.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${utcInstant(asOf)} ORDER BY "knownAt" DESC,"id" ASC LIMIT 1`.then(rows=>authorizeInstrumentRows(tx,rows));
  const universe=await authorizedUniverseAt(tx,universes.map(row=>row.evidence),asOf),listings=canonicalListings(instruments.map(row=>row.evidence),universe.members,asOf);
  const evidence={scanId,asOf,universe,listings},json=canonical(evidence);
  await tx.$executeRaw`INSERT INTO "ScanUniverseSnapshot" ("scanId","knownAt","evidence") VALUES (${scanId}::uuid,${utcInstant(asOf)},${json}::jsonb) ON CONFLICT ("scanId") DO NOTHING`;
  const previous=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "ScanUniverseSnapshot" WHERE "scanId"=${scanId}::uuid`;
  if(canonical(previous[0]?.evidence)!==json)throw new Error('STALE_CONFLICT: scan universe already pinned');return evidence;
 },{isolationLevel:'RepeatableRead'});
}
export async function persistSectors(db:PrismaClient,mappings:readonly SectorMapping[],knownAt:string,source?:SourceRecord){
 const cutoff=utcInstant(knownAt);if(mappings.some(row=>utcInstant(row.knownAt)>cutoff))throw new Error('SECTOR_NOT_YET_KNOWN');
 for(const isin of new Set(mappings.map(row=>row.isin)))sectorAt(mappings,isin,knownAt);
 if(!source||source.dataset!=='SECTORS'||sourcePermission(source,'STORE',knownAt).status!=='PASS')throw new Error('SECTOR_STORAGE_PERMISSION_REQUIRED');
 const evidence={knownAt,source,mappings:[...mappings].sort((a,b)=>a.isin.localeCompare(b.isin)||a.validFrom.localeCompare(b.validFrom))},id=hash(evidence),json=canonical(evidence);
 await db.$transaction(async tx=>{
  await lockSourceScope(tx,source);
  if((await registeredSourceReasons(tx,source,['STORE'],new Date().toISOString())).length)throw new Error('SECTOR_STORAGE_PERMISSION_REQUIRED');
  await tx.$executeRaw`INSERT INTO "SectorSnapshot" ("id","knownAt","evidence") VALUES (${id},${cutoff},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;
 });return {id,...evidence};
}
export async function readSectorSnapshot(db:Pick<PrismaClient,'$queryRaw'>,asOf=new Date().toISOString()){
 const rows=await db.$queryRaw<{id:string;evidence:{source?:SourceRecord;mappings:SectorMapping[]}}[]>`SELECT "id","evidence" FROM "SectorSnapshot" WHERE "knownAt"<=${utcInstant(asOf)} ORDER BY "knownAt" DESC,"id" ASC LIMIT 1`;
 const source=rows[0]?.evidence.source;
 if(!source||source.dataset!=='SECTORS'||(await registeredSourceReasons(db,source,['DISPLAY','DERIVE'],new Date().toISOString())).length)return null;
 return rows[0]??null;
}
export async function getSector(db:PrismaClient,isin:string,asOf=new Date().toISOString()){
 return sectorAt((await readSectorSnapshot(db,asOf))?.evidence.mappings??[],isin,asOf);
}
