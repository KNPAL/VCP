import {PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
import {validateInstrumentSnapshot,canonicalListings,universeAt,sectorAt,type InstrumentSnapshot,type UniverseSnapshot,type SectorMapping} from '@vcp/market-data';
import {utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';
const hash=(data:unknown)=>createHash('sha256').update(canonical(data)).digest('hex');
export async function persistInstrumentSnapshot(db:PrismaClient,input:Omit<InstrumentSnapshot,'id'>){
 const normalized={...input,rows:[...input.rows].sort((a,b)=>a.listingId.localeCompare(b.listingId)||a.provider.localeCompare(b.provider)||a.validFrom.localeCompare(b.validFrom))};
 const snapshot={...normalized,id:hash(normalized)};validateInstrumentSnapshot(snapshot);
 return db.$transaction(async tx=>{
  const json=canonical(snapshot);await tx.$executeRaw`INSERT INTO "InstrumentSnapshot" ("id","knownAt","sourceReference","evidence") VALUES (${snapshot.id},${utcInstant(snapshot.knownAt)},${snapshot.sourceReference},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;
  for(const row of snapshot.rows){
   await tx.$executeRaw`INSERT INTO "Company" ("id","isin") VALUES (${row.companyId}::uuid,${row.isin}) ON CONFLICT DO NOTHING`;
   const companies=await tx.$queryRaw<{isin:string}[]>`SELECT "isin" FROM "Company" WHERE "id"=${row.companyId}::uuid`;if(companies[0]?.isin!==row.isin)throw new Error('COMPANY_IDENTITY_CONFLICT');
   await tx.$executeRaw`INSERT INTO "Listing" ("id","companyId","exchange") VALUES (${row.listingId}::uuid,${row.companyId}::uuid,${row.exchange}) ON CONFLICT DO NOTHING`;
   const listings=await tx.$queryRaw<{companyId:string;exchange:string}[]>`SELECT "companyId","exchange" FROM "Listing" WHERE "id"=${row.listingId}::uuid`;if(listings[0]?.companyId!==row.companyId||listings[0]?.exchange!==row.exchange)throw new Error('LISTING_IDENTITY_CONFLICT');
   const mappingId=hash([snapshot.id,row]),mappingJson=canonical(row);
   await tx.$executeRaw`INSERT INTO "ListingMapping" ("id","snapshotId","listingId","provider","token","validFrom","validTo","evidence") VALUES (${mappingId},${snapshot.id},${row.listingId}::uuid,${row.provider},${row.token},${new Date(row.validFrom)},${row.validTo?new Date(row.validTo):null},${mappingJson}::jsonb) ON CONFLICT ("id") DO NOTHING`;
  }return snapshot;
 });
}
export async function persistUniverse(db:PrismaClient,input:Omit<UniverseSnapshot,'id'>){
 const normalized={...input,isins:[...input.isins].sort()},snapshot={...normalized,id:hash(normalized)};universeAt([snapshot],snapshot.knownAt);
 const json=canonical(snapshot);await db.$executeRaw`INSERT INTO "UniverseSnapshot" ("id","knownAt","evidence") VALUES (${snapshot.id},${utcInstant(snapshot.knownAt)},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;return snapshot;
}
export async function pinScanUniverse(db:PrismaClient,scanId:string,asOf:string){
 return db.$transaction(async tx=>{
  const universes=await tx.$queryRaw<{evidence:UniverseSnapshot}[]>`SELECT "evidence" FROM "UniverseSnapshot" WHERE "knownAt"<=${utcInstant(asOf)}`;
  const instruments=await tx.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${utcInstant(asOf)} ORDER BY "knownAt" DESC,"id" ASC LIMIT 1`;
  const universe=universeAt(universes.map(row=>row.evidence),asOf),listings=canonicalListings(instruments.map(row=>row.evidence),universe.members,asOf);
  const evidence={scanId,asOf,universe,listings},json=canonical(evidence);
  await tx.$executeRaw`INSERT INTO "ScanUniverseSnapshot" ("scanId","knownAt","evidence") VALUES (${scanId}::uuid,${utcInstant(asOf)},${json}::jsonb) ON CONFLICT ("scanId") DO NOTHING`;
  const previous=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "ScanUniverseSnapshot" WHERE "scanId"=${scanId}::uuid`;
  if(canonical(previous[0]?.evidence)!==json)throw new Error('STALE_CONFLICT: scan universe already pinned');return evidence;
 },{isolationLevel:'RepeatableRead'});
}
export async function persistSectors(db:PrismaClient,mappings:readonly SectorMapping[],knownAt:string){
 const cutoff=utcInstant(knownAt);if(mappings.some(row=>utcInstant(row.knownAt)>cutoff))throw new Error('SECTOR_NOT_YET_KNOWN');
 for(const isin of new Set(mappings.map(row=>row.isin)))sectorAt(mappings,isin,knownAt);
 const evidence={knownAt,mappings:[...mappings].sort((a,b)=>a.isin.localeCompare(b.isin)||a.validFrom.localeCompare(b.validFrom))},id=hash(evidence),json=canonical(evidence);
 await db.$executeRaw`INSERT INTO "SectorSnapshot" ("id","knownAt","evidence") VALUES (${id},${cutoff},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;return {id,...evidence};
}
export async function getSector(db:PrismaClient,isin:string,asOf=new Date().toISOString()){
 const rows=await db.$queryRaw<{evidence:{mappings:SectorMapping[]}}[]>`SELECT "evidence" FROM "SectorSnapshot" WHERE "knownAt"<=${utcInstant(asOf)} ORDER BY "knownAt" DESC,"id" ASC LIMIT 1`;
 return sectorAt(rows[0]?.evidence.mappings??[],isin,asOf);
}
