import {readFile} from 'node:fs/promises';
import {runPaperSession,readPaperPerformance,compareStoredWalkForward} from '../packages/database/dist/index.js';
import {PrismaClient,persistHistoricalSnapshot,readHistoricalSlice,persistHistoricalReplay,readHistoricalReplay,persistHistoricalEntry,persistHistoricalExit,initializePaperLedger,loadPaperLedger,applyHistoricalDecisionToPaper,applyPaperCorporateActions,persistPaperProtection,persistPaperDailyExit,persistPaperOpeningExit} from '../packages/database/dist/index.js';
const [mode,...args]=process.argv.slice(2);
if(!process.env.DATABASE_URL||!process.env.VCP_REPLAY_OWNER_ID)throw new Error('DATABASE_URL and VCP_REPLAY_OWNER_ID are required');
const db=new PrismaClient();
try{
 if(mode==='pin'&&args.length===2){
  const [requestId,path]=args,source=await readFile(path,'utf8');
  if(Buffer.byteLength(source)>50*1024*1024)throw new Error('SNAPSHOT_TOO_LARGE');
  const result=await persistHistoricalSnapshot(db,process.env.VCP_REPLAY_OWNER_ID,requestId,JSON.parse(source));
  console.log(JSON.stringify({id:result.id,snapshotHash:result.snapshot.id,strategyRevision:result.strategyRevision,dataRevision:result.dataRevision,executable:false}));
 }else if(mode==='slice'&&args.length===2){
  console.log(JSON.stringify(await readHistoricalSlice(db,process.env.VCP_REPLAY_OWNER_ID,args[0],args[1]),null,2));
 }else if(mode==='replay'&&args.length>=1&&args.length<=2){
  const assumptions=args[1]?JSON.parse(await readFile(args[1],'utf8')):[];
  console.log(JSON.stringify(await persistHistoricalReplay(db,process.env.VCP_REPLAY_OWNER_ID,args[0],assumptions),null,2));
 }else if(mode==='events'&&args.length===1){
  console.log(JSON.stringify(await readHistoricalReplay(db,process.env.VCP_REPLAY_OWNER_ID,args[0]),null,2));
 }else if(mode==='entry'&&args.length===3){
  console.log(JSON.stringify(await persistHistoricalEntry(db,process.env.VCP_REPLAY_OWNER_ID,args[0],args[1],JSON.parse(await readFile(args[2],'utf8'))),null,2));
 }else if(mode==='exit'&&args.length===2){
  console.log(JSON.stringify(await persistHistoricalExit(db,process.env.VCP_REPLAY_OWNER_ID,args[0],JSON.parse(await readFile(args[1],'utf8'))),null,2));
 }else if(mode==='paper-init'&&args.length===2){
  console.log(JSON.stringify(await initializePaperLedger(db,process.env.VCP_REPLAY_OWNER_ID,args[0],args[1]),null,2));
 }else if(mode==='paper-ledger'&&args.length===1){
  console.log(JSON.stringify(await loadPaperLedger(db,process.env.VCP_REPLAY_OWNER_ID,args[0]),null,2));
 }else if(mode==='paper-apply'&&args.length===4){
  console.log(JSON.stringify(await applyHistoricalDecisionToPaper(db,process.env.VCP_REPLAY_OWNER_ID,args[0],args[1],args[2],args[3]),null,2));
 }else if(mode==='paper-actions'&&args.length===3){
  console.log(JSON.stringify(await applyPaperCorporateActions(db,process.env.VCP_REPLAY_OWNER_ID,args[0],args[1],args[2]),null,2));
 }else if(mode==='paper-protection'&&args.length===3){
  console.log(JSON.stringify(await persistPaperProtection(db,process.env.VCP_REPLAY_OWNER_ID,args[0],args[1],args[2]),null,2));
 }else if(mode==='paper-exit'&&args.length===4){
  if(!['TRADABLE','PRICE_LIMIT_LOCKED','UNKNOWN'].includes(args[3]))throw new Error('PAPER_LIQUIDITY_INVALID');
  console.log(JSON.stringify(await persistPaperDailyExit(db,process.env.VCP_REPLAY_OWNER_ID,args[0],args[1],args[2],args[3]),null,2));
 }else if(mode==='paper-opening-exit'&&args.length===5){
  if(!['TRADABLE','PRICE_LIMIT_LOCKED','UNKNOWN'].includes(args[4]))throw new Error('PAPER_LIQUIDITY_INVALID');
  console.log(JSON.stringify(await persistPaperOpeningExit(db,process.env.VCP_REPLAY_OWNER_ID,args[0],args[1],args[2],JSON.parse(await readFile(args[3],'utf8')),args[4]),null,2));
 }else if(mode==='paper-session'&&args.length===2){
  console.log(JSON.stringify(await runPaperSession(db,process.env.VCP_REPLAY_OWNER_ID,args[0],JSON.parse(await readFile(args[1],'utf8'))),null,2));
 }else if(mode==='paper-report'&&(args.length===2||args.length===3)){
  console.log(JSON.stringify(await readPaperPerformance(db,process.env.VCP_REPLAY_OWNER_ID,args[0],args[1],args[2]?JSON.parse(await readFile(args[2],'utf8')):null),null,2));
 }else if(mode==='walk-forward'&&args.length===1){
  console.log(JSON.stringify(await compareStoredWalkForward(db,process.env.VCP_REPLAY_OWNER_ID,JSON.parse(await readFile(args[0],'utf8'))),null,2));
 }else throw new Error('Usage: historical-snapshot.mjs pin <request-id> <archive.json> | slice <snapshot-id> <as-of-UTC> | replay <snapshot-id> [assumptions.json] | events <run-id> | entry <run-id> <replay-event-id> <attempt.json> | exit <run-id> <attempt.json> | paper-init <run-id> <initial-capital> | paper-ledger <run-id> | paper-apply <run-id> <ENTRY|EXIT|OPENING_EXIT> <decision-id> <expected-revision> | paper-actions <run-id> <session-date> <expected-revision> | paper-protection <run-id> <isin> <as-of-UTC> | paper-exit <run-id> <isin> <as-of-UTC> <liquidity> | paper-opening-exit <run-id> <isin> <opening-UTC> <opening.json> <liquidity> | paper-session <run-id> <session.json>');
}finally{await db.$disconnect()}
