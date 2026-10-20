import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Catch, Controller, Get, Post, Delete, Param, Query, Req, Res, HttpException, Module, BadRequestException, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter, PipeTransform } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { STRATEGY_VERSION, errorCodes, wireSchemas, InputError } from '@vcp/domain';
import { AuthService, databaseFromEnvironment } from './auth.js';
import type { AuthRequest, AuthResponse } from './auth.js';
import type { PrismaClient } from '@vcp/database';
import {getScan,latestScan,appendPortfolio,readPortfolio,readPortfolioRisk,getReadiness,syncJobs,instrumentCoverage,readWatchlists,changeWatchlist,watchlistInstruments,eodScanProgress,getDailyStructure,schedulerStatus} from '@vcp/database';
import type {JournalCommand} from '@vcp/database';
import {recordEntryRisk,readEntryRisk,recordCashAllocation} from '@vcp/database';
import {candidatePage} from '@vcp/strategy';
import {registerProfile,validateProfileVersion,readProfileHistory,patternHistory,readPositionMonitor,readReconciliation,recordReconciliation,readPositionStops} from '@vcp/database';
import {withLogContext,logContext,writeLog,type LogSink} from '@vcp/domain/logging';

export class StrictObjectPipe implements PipeTransform {
  constructor(private readonly fields: Readonly<Record<string, (value: unknown) => boolean>>) {}
  transform(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BadRequestException('Object required');
    const object = value as Record<string, unknown>;
    if (Object.keys(object).some(key => !Object.hasOwn(this.fields, key))) throw new BadRequestException('Unknown field');
    for (const [key, validate] of Object.entries(this.fields)) if (!validate(object[key])) throw new BadRequestException(`Invalid field: ${key}`);
    return object;
  }
}
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader: (key: string, value: string) => void };
type Request = { requestId?: string };
@Catch()
class Errors implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const request = http.getRequest<Request>();
    http.getResponse<Response>().status(status).json({ error: {
      code: errorCodes[status as keyof typeof errorCodes] ?? 'INTERNAL_ERROR',
      message: status >= 500 ? 'Internal server error' : exception instanceof HttpException ? exception.message : 'Request failed',
      details: null, requestId: request.requestId ?? randomUUID(),
    }, at: new Date().toISOString() });
  }
}
export const openapi = {
  openapi: '3.1.0', info: { title: 'Study Trade VCP', version: '4.0.0' },
  components: { schemas: wireSchemas, securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'vcp_session' } } },
  paths: {
    '/api/v1/positions/stops':{get:{operationId:'protectiveStopEvidence',security:[{session:[]}],responses:{'200':{description:'Own current holding episodes, immutable initial stops and protective SELL observations; no execution implied'},'401':{description:'Authentication required'}}}},
    '/api/v1/watchlists':{get:{operationId:'savedWatchlists',security:[{session:[]}],responses:{'200':{description:'Owner lists, persisted query/exchange filters, saved timestamps and explicit UNKNOWN research status'}}},post:{operationId:'saveWatchlist',security:[{session:[]}],responses:{'201':{description:'Create a named list or replace its query/exchange filters; CSRF required'}}}},
    '/api/v1/watchlists/instruments':{get:{operationId:'watchlistInstruments',security:[{session:[]}],responses:{'200':{description:'Current verified canonical cash-equity listings; missing mapping yields empty items with reason'}}}},
    '/api/v1/watchlists/{id}/items':{post:{operationId:'addWatchlistItem',security:[{session:[]}],responses:{'201':{description:'Add canonical listingId once; CSRF required'},'404':{description:'List not owned by caller'},'422':{description:'Listing is not currently canonical'}}}},
    '/api/v1/watchlists/{id}/items/{listingId}':{delete:{operationId:'removeWatchlistItem',security:[{session:[]}],responses:{'200':{description:'Idempotent removal; immutable audit retained; CSRF required'},'404':{description:'List not owned by caller'}}}},
    '/api/v1/sources/readiness':{get:{operationId:'sourceReadiness',security:[{session:[]}],responses:{'200':{description:'All G01–G10 proof statuses, source timestamps, expiry, blocked capabilities and exact failure policies'},'401':{description:'Authentication required'}}}},
    '/api/v1/portfolio':{get:{operationId:'portfolioJournal',security:[{session:[]}],responses:{'200':{description:'Actual signed cash, FIFO positions, immutable journal, feed monitoring, reconciliation and current verified valuation or explicit unknowns'}}}},
    '/api/v1/portfolio/risk':{get:{operationId:'portfolioRisk',security:[{session:[]}],responses:{'200':{description:'Journal-bound valuation, mark ages, company/sector exposure, planned downside, snapshot deadline and separate blocked entry-plan reasons'}}}},
    '/api/v1/portfolio/risk/plans':{get:{operationId:'entryRiskHistory',security:[{session:[]}],responses:{'200':{description:'Owner-scoped immutable plan evidence with expiry and journal invalidation'}}},post:{operationId:'recordEntryRisk',security:[{session:[]}],parameters:[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string'}},{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}}],responses:{'201':{description:'Blocked entry-plan evidence recorded without a fill or order'},'409':{description:'Stale snapshot, changed journal or conflicting retry'},'422':{description:'Invalid source event or request'}}}},
    '/api/v1/portfolio/reconciliation':{get:{operationId:'portfolioReconciliation',security:[{session:[]}],responses:{'200':{description:'Owner statement history and journal-hash-bound reconciliation state'}}},post:{operationId:'recordPortfolioReconciliation',security:[{session:[]}],parameters:[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string'}},{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}}],responses:{'201':{description:'Immutable statement comparison recorded; no holdings or orders changed'},'409':{description:'Conflicting request or older statement'},'422':{description:'Invalid statement evidence'}}}},
    '/api/v1/portfolio/cash':{post:{operationId:'recordCash',security:[{session:[]}],parameters:[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',maxLength:128}},{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}}],responses:{'201':{description:'Verified cash event recorded once'},'409':{description:'Initial capital or idempotency conflict'},'422':{description:'Invalid cash evidence'}}}},
    '/api/v1/positions':{get:{operationId:'actualPositions',security:[{session:[]}],responses:{'200':{description:'Per-ISIN actual holdings and FIFO lots'}}},post:{operationId:'recordActualBuy',security:[{session:[]}],parameters:[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string'}}],responses:{'201':{description:'Actual manual fill recorded atomically; no brokerage order'},'409':{description:'Duplicate source or idempotency conflict'}}}},
    '/api/v1/positions/{id}/fills':{post:{operationId:'recordActualFill',security:[{session:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string',description:'Canonical company ISIN'}},{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string'}}],responses:{'201':{description:'Actual BUY or SELL fact recorded, with FIFO fee allocation'},'409':{description:'Oversell, duplicate source or idempotency conflict'}}}},
    '/api/v1/positions/fills/{id}/correct':{post:{operationId:'correctActualFill',security:[{session:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}},{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string'}}],responses:{'201':{description:'Linked reversal and replacement appended atomically, original retained'},'422':{description:'Invalid correction target or chronology'}}}},
    '/api/v1/vcp/lifecycle/{id}':{get:{operationId:'patternLifecycle',security:[{session:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string',pattern:'^[a-f0-9]{64}$'}}],responses:{'200':{description:'Immutable pattern observations, transitions and separate market breakouts; explicit UNKNOWN if absent'},'400':{description:'Invalid pattern identity'},'401':{description:'Authentication required'}}}},
    '/api/v1/vcp/profiles':{get:{operationId:'strategyHistory',security:[{session:[]}],responses:{'200':{description:'Immutable versions, activation history and supported execution hash'}}},post:{operationId:'saveStrategyVersion',security:[{session:[]}],responses:{'201':{description:'Idempotently registered version; activation unchanged'},'409':{description:'Immutable version conflict'},'422':{description:'Invalid configuration or unsupported authority'}}}},
    '/api/v1/vcp/latest-scan':{get:{operationId:'latestScanSummary',security:[{session:[]}],responses:{'200':{description:'Latest stored scan identity and coverage, or explicit UNKNOWN when absent'},'401':{description:'Authentication required'}}}},
    '/api/v1/vcp/candidates': {
      get: {operationId:'vcpCandidates',security:[{session:[]}],parameters:[
        {name:'scanId',in:'query',required:true,schema:{type:'string',format:'uuid'}},
        {name:'state',in:'query',schema:{type:'string',enum:['BUY_MARKET_SIGNAL','READY','WATCH','DEVELOPING','BLOCKED_DATA','REJECTED']}},
        {name:'cursor',in:'query',schema:{type:'string'}},
        {name:'sort',in:'query',schema:{type:'string',enum:['rank']}},
        {name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:200,default:50}},
      ],responses:{'200':{description:'Rank-stable page from one immutable scan; decimal values remain strings and missing values null'},'400':{description:'Invalid query or cursor does not match scan/filter'},'401':{description:'Authentication required'},'404':{description:'Scan not found'}}},
    },
    '/api/v1/system/scans/{id}': {get:{operationId:'scanEvidence',security:[{session:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{'200':{description:'Immutable intended universe, per-listing reasons, coverage counts and ranked candidates'},'404':{description:'Scan not found'}}}},
    '/api/v1/system/scheduler': {get:{operationId:'schedulerStatus',security:[{session:[]}],responses:{'200':{description:'Last fenced calendar observation, typed waiting reason and recent scheduled preparation states'},'401':{description:'Authentication required'}}}},
    '/api/v1/system/scan-jobs/{id}': {get:{operationId:'eodScanProgress',security:[{session:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{'200':{description:'Pinned EOD scan revision, completed checkpoints, queue failure state and final result'},'400':{description:'Invalid ID'},'401':{description:'Authentication required'},'404':{description:'Scan plan not found'}}}},
    '/api/v1/system/daily-structure/{id}': {get:{operationId:'dailyStructureEvidence',security:[{session:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string',pattern:'^[0-9a-f]{64}$'}}],responses:{'200':{description:'Immutable source inputs, prior execution identity, breakout decision and subsequent detector result'},'400':{description:'Invalid ID'},'401':{description:'Authentication required'},'404':{description:'Execution not found'}}}},
    '/api/v1/system/data-gaps': {get:{operationId:'dataGaps',security:[{session:[]}],responses:{'200':{description:'Latest scan missing and excluded listings, or explicit NO_COMPLETED_SCAN UNKNOWN state'}}}},
    '/api/v1/system/jobs': {get:{operationId:'historicalSyncJobs',security:[{session:[]}],parameters:[{name:'runId',in:'query',schema:{type:'string',format:'uuid'}},{name:'after',in:'query',schema:{type:'string',format:'uuid'}},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:200}}],responses:{'200':{description:'Persistent sync windows, attempts, exact response coverage and retry state'},'400':{description:'Invalid filters'}}}},
    '/api/v1/system/coverage/{listingId}': {get:{operationId:'instrumentCoverage',security:[{session:[]}],parameters:[{name:'listingId',in:'path',required:true,schema:{type:'string',format:'uuid'}},{name:'provider',in:'query',required:true,schema:{type:'string'}}],responses:{'200':{description:'Source-specific final session, holes, revision, rejected candles and last successful window; missing evidence is UNKNOWN'},'400':{description:'Listing ID and provider required'}}}},
    '/api/v1/system/health': {
      get: {
        operationId: 'systemHealth',
        responses: {
          '200': {
            description: 'HTTP process liveness only; does not assert trading readiness',
            content: {
              'application/json': {
                schema: {
                  type: 'object', required: ['status','strategyVersion','at'], additionalProperties: false,
                  properties: { status: { const: 'UP' }, strategyVersion: { const: STRATEGY_VERSION }, at: { type: 'string', format: 'date-time' } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
@Controller('system')
class SystemController {
  @Get('health') health() { return { status: 'UP', strategyVersion: STRATEGY_VERSION, at: new Date().toISOString() }; }
  @Get('openapi.json') specification() { return openapi; }
}
export async function createApp(options: {db?:PrismaClient;origin?:string;secure?:boolean;logSink?:LogSink} = {}) {
  const db = options.db ?? await databaseFromEnvironment();
  const auth = new AuthService(db, options.origin ?? process.env['APP_ORIGIN'] ?? 'http://localhost:3000', options.secure ?? process.env['COOKIE_SECURE'] !== 'false');
  @Controller('auth')
  class AuthController {
    @Post('login') login(@Req() request:AuthRequest,@Res({passthrough:true}) response:AuthResponse) { return auth.login(request,response); }
    @Post('logout') logout(@Req() request:AuthRequest,@Res({passthrough:true}) response:AuthResponse) { return auth.logout(request,response); }
    @Get('session') session(@Req() request:AuthRequest) { return auth.session(request); }
  }
  @Controller('patterns')
  class PatternController {
    @Get(':id') async detail(@Param('id') id:string){
      if(!/^[a-f0-9]{64}$/.test(id))throw new BadRequestException('Invalid pattern ID');
      const snapshots=await db.patternSnapshot.findMany({where:{patternId:id},orderBy:[{session:'desc'},{decidedAt:'desc'}]});
      if(!snapshots.length)throw new NotFoundException('Pattern not found');
      const replacement=await db.patternReplacement.findUnique({where:{oldId:id}});
      return {items:snapshots,nextCursor:null,asOf:snapshots[0]!.asOf.toISOString(),dataRevision:snapshots[0]!.dataRevision,replacement};
    }
  }
  @Controller('vcp')
  class CandidateController {
    @Get('lifecycle/:id') async lifecycle(@Param('id') id:string){if(!/^[a-f0-9]{64}$/.test(id))throw new BadRequestException('Invalid pattern ID');return patternHistory(db,id)}
    @Get('profiles') profiles(){return readProfileHistory(db)}
    @Post('profiles') async profile(@Req() request:AuthRequest){
      const body=strictBody(request,['version','configuration']);
      try{const validated=validateProfileVersion(body['version'],body['configuration']);const saved=await registerProfile(db,validated.version,validated.configuration);return {id:saved.id,version:saved.version,createdAt:saved.createdAt,activationChanged:false}}
      catch(error){const message=error instanceof Error?error.message:'';if(message.startsWith('IMMUTABLE_'))throw new HttpException(message,409);if(/^(INVALID_|UNSUPPORTED_|PROFILE_VERSION_)/.test(message))throw new HttpException(message,422);throw error}
    }
    @Get('latest-scan') async latest(){
      const scan=await latestScan(db);
      return scan?{scanId:scan.scanId,asOf:scan.asOf,dataRevision:scan.dataRevision,status:scan.status,counts:scan.counts}:{scanId:null,status:'UNKNOWN',reason:'NO_COMPLETED_SCAN'};
    }
    @Get('candidates') async candidates(@Query() query:Record<string,string>){
      if(Object.keys(query).some(key=>!['state','scanId','cursor','sort','limit'].includes(key))||Object.values(query).some(value=>typeof value!=='string'))throw new BadRequestException('Invalid query');
      if(!query['scanId']||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(query['scanId']))throw new BadRequestException('A scanId UUID is required');
      const scan=await getScan(db,query['scanId']);if(!scan)throw new NotFoundException('Scan not found');
      try{return candidatePage(scan,{...(query['state']?{state:query['state']}:{}),...(query['cursor']?{cursor:query['cursor']}:{}),...(query['sort']?{sort:query['sort']}:{}),...(query['limit']?{limit:Number(query['limit'])}:{})})}
      catch(error){throw new BadRequestException(error instanceof Error?error.message:'Invalid page query')}
    }
  }
  function strictBody(request:AuthRequest,fields:readonly string[]){
    const body=request.body;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!fields.includes(key)))throw new BadRequestException('Invalid fields');
    return body as Record<string,unknown>;
  }
  function fillBody(body:Record<string,unknown>,isin?:string){
    const selectedIsin=isin??body['isin'];
    if(typeof selectedIsin!=='string'||!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(selectedIsin)||!['BUY','SELL'].includes(String(body['side']))||typeof body['quantity']!=='number'||!Number.isSafeInteger(body['quantity'])||body['quantity']<=0)throw new BadRequestException('Invalid fill quantity, ISIN or side');
    for(const key of ['price','fees','brokerReference','occurredAt','sourceId'])if(typeof body[key]!=='string'||!body[key]||body[key].length>256)throw new BadRequestException('Invalid fill field: '+key);
    return {kind:'FILL' as const,isin:selectedIsin,side:body['side'] as 'BUY'|'SELL',quantity:body['quantity'],price:body['price'] as string,fees:body['fees'] as string,brokerReference:body['brokerReference'] as string,occurredAt:body['occurredAt'] as string,sourceId:body['sourceId'] as string};
  }
  @Controller('watchlists')
  class WatchlistController {
    @Get() lists(@Req() request:AuthRequest){return readWatchlists(db,request.ownerId!)}
    @Get('instruments') instruments(){return watchlistInstruments(db)}
    async change(request:AuthRequest,command:Parameters<typeof changeWatchlist>[2]){
      try{return await changeWatchlist(db,request.ownerId!,command)}catch(error){const message=error instanceof Error?error.message:'';if(message==='WATCHLIST_NOT_FOUND')throw new NotFoundException(message);if(message.startsWith('INVALID_'))throw new HttpException(message,422);throw error}
    }
    @Post() save(@Req() request:AuthRequest){const body=strictBody(request,['name','filters']);return this.change(request,{kind:'SAVE',name:body['name'] as string,filters:body['filters']})}
    @Post(':id/items') add(@Param('id') id:string,@Req() request:AuthRequest){const body=strictBody(request,['listingId']);if(typeof body['listingId']!=='string')throw new BadRequestException('listingId required');return this.change(request,{kind:'ADD',id,listingId:body['listingId']})}
    @Delete(':id/items/:listingId') remove(@Param('id') id:string,@Param('listingId') listingId:string,@Req() request:AuthRequest){return this.change(request,{kind:'REMOVE',id,listingId})}
  }
  async function writeJournal(request:AuthRequest,command:JournalCommand){
    const key=request.headers['idempotency-key'];if(typeof key!=='string')throw new BadRequestException('Idempotency-Key required');
    try{return await appendPortfolio(db,request.ownerId!,key,command)}
    catch(error){
      const message=error instanceof Error?error.message:'';
      if(message.startsWith('STALE_CONFLICT')||message==='DUPLICATE_BROKER_FILL'||message==='SELL_EXCEEDS_HOLDINGS'||message.startsWith('INITIAL_CAPITAL'))throw new HttpException(message,409);
      if(/^(INVALID_|UNVERIFIED_|FUTURE_|REPLACEMENT_)/.test(message))throw new HttpException(message,422);
      if(error instanceof InputError)throw new BadRequestException(message);
      throw error;
    }
  }
  @Controller('positions')
  class PositionController {
    @Get('stops') stops(@Req() request:AuthRequest){return readPositionStops(db,request.ownerId!)}
    @Get() async positions(@Req() request:AuthRequest){const p=await readPortfolio(db,request.ownerId!);return {items:Object.entries(p.holdings).map(([isin,quantity])=>({id:isin,isin,quantity,lots:p.lots.filter(lot=>lot.isin===isin&&lot.remainingQty>0)})),asOf:p.asOf,cash:p.cash,realizedPnl:p.realizedPnl}}
    @Post() async open(@Req() request:AuthRequest){
      const body=strictBody(request,['isin','side','quantity','price','fees','brokerReference','occurredAt','sourceId']);
      if(body['side']!=='BUY')throw new BadRequestException('New position requires an actual BUY fill');return writeJournal(request,fillBody(body));
    }
    @Post(':id/fills') async fill(@Param('id') isin:string,@Req() request:AuthRequest){return writeJournal(request,fillBody(strictBody(request,['side','quantity','price','fees','brokerReference','occurredAt','sourceId']),isin))}
    @Post('fills/:id/correct') async correct(@Param('id') id:string,@Req() request:AuthRequest){
      if(!/^[0-9a-f-]{36}$/.test(id))throw new BadRequestException('Invalid fill ID');
      const body=strictBody(request,['reason','replacement']);if(typeof body['reason']!=='string'||!body['reason'].trim()||body['reason'].length>1000)throw new BadRequestException('Correction reason required');
      const replacement=strictBody({...request,body:body['replacement']},['isin','side','quantity','price','fees','brokerReference','occurredAt','sourceId']);
      return writeJournal(request,{kind:'CORRECTION',targetId:id,reason:body['reason'],replacement:fillBody(replacement)});
    }
  }
  @Controller('portfolio')
  class PortfolioController {
    @Get() async portfolio(@Req() request:AuthRequest){const risk=await readPortfolioRisk(db,request.ownerId!);return {...risk.journal,monitor:await readPositionMonitor(db,request.ownerId!),equity:risk.valuation.equity,risk,reconciliation:risk.reconciliation.state,reconciliationEvidence:risk.reconciliation,reasons:risk.reasons}}
    @Get('risk') risk(@Req() request:AuthRequest){return readPortfolioRisk(db,request.ownerId!)}
    @Get('loss-streak') async lossStreak(@Req() request:AuthRequest){const risk=await readPortfolioRisk(db,request.ownerId!);return {...risk.lossStreak,journalHash:risk.journalHash,cashAllocationRevision:risk.cashAllocationRevision}}
    @Post('cash-allocations') async allocateCash(@Req() request:AuthRequest){
      const body=strictBody(request,['cashEventId','episodeId','reason']),key=request.headers['idempotency-key'];
      if(typeof key!=='string'||typeof body['cashEventId']!=='string'||typeof body['episodeId']!=='string'||typeof body['reason']!=='string')throw new BadRequestException('Cash event, position episode, reason and Idempotency-Key required');
      try{return await recordCashAllocation(db,request.ownerId!,key,body as unknown as Parameters<typeof recordCashAllocation>[3])}
      catch(error){if(!(error instanceof Error)||!['STALE_CONFLICT','INVALID_CASH_ALLOCATION'].includes(error.message))throw error;throw new HttpException({code:error.message==='STALE_CONFLICT'?'STALE_CONFLICT':'INVALID_INPUT',message:'Cash allocation is invalid or conflicts with an existing request'},error.message==='STALE_CONFLICT'?409:422)}
    }
    @Get('risk/plans') plans(@Req() request:AuthRequest){return readEntryRisk(db,request.ownerId!)}
    @Post('risk/plans') async plan(@Req() request:AuthRequest){
      const body=strictBody(request,['marketEventId','snapshotId','estimatedFees']),key=request.headers['idempotency-key'];
      if(typeof key!=='string'||typeof body['marketEventId']!=='string'||typeof body['snapshotId']!=='string'||typeof body['estimatedFees']!=='string')throw new BadRequestException('Market event, snapshot, estimated fees and Idempotency-Key required');
      try{return await recordEntryRisk(db,request.ownerId!,key,body as unknown as Parameters<typeof recordEntryRisk>[3])}
      catch(error){const conflict=error instanceof Error&&error.message==='STALE_CONFLICT';if(!conflict&&!(error instanceof InputError)&&!(error instanceof Error&&['INVALID_ENTRY_PLAN','MARKET_EVENT_UNAVAILABLE'].includes(error.message)))throw error;throw new HttpException({code:conflict?'STALE_CONFLICT':'INVALID_INPUT',message:conflict?'Snapshot or idempotency key no longer matches current evidence':'Entry-plan source is missing or invalid'},conflict?409:422)}
    }
    @Get('reconciliation') reconciliation(@Req() request:AuthRequest){return readReconciliation(db,request.ownerId!)}
    @Post('reconciliation') async reconcile(@Req() request:AuthRequest){
      const body=strictBody(request,['asOf','sourceReference','cash','holdings','fillReferences','allOutsideActivityIncluded']),key=request.headers['idempotency-key'];
      if(typeof key!=='string'||typeof body['asOf']!=='string'||typeof body['sourceReference']!=='string'||typeof body['cash']!=='string'||typeof body['allOutsideActivityIncluded']!=='boolean'||!Array.isArray(body['holdings'])||!Array.isArray(body['fillReferences']))throw new BadRequestException('Complete statement and Idempotency-Key required');
      for(const item of body['holdings']){const row=strictBody({...request,body:item},['isin','quantity']);if(typeof row['isin']!=='string'||typeof row['quantity']!=='number')throw new BadRequestException('Invalid statement holding')}
      try{return await recordReconciliation(db,request.ownerId!,key,body as unknown as Parameters<typeof recordReconciliation>[3])}catch(error){throw new HttpException({code:error instanceof Error&&error.message==='STALE_CONFLICT'?'STALE_CONFLICT':'INVALID_INPUT',message:error instanceof Error&&error.message==='STALE_CONFLICT'?'Statement or request conflicts with newer evidence':'Invalid reconciliation statement'},error instanceof Error&&error.message==='STALE_CONFLICT'?409:422)}
    }
    @Post('cash') cash(@Req() request:AuthRequest){
      const body=strictBody(request,['kind','amount','verified','occurredAt','sourceId']);
      if(!['INITIAL_CAPITAL','DEPOSIT','WITHDRAWAL','FEE','DIVIDEND','CORPORATE_CREDIT','CORPORATE_DEBIT'].includes(String(body['kind']))||typeof body['amount']!=='string'||typeof body['occurredAt']!=='string'||typeof body['sourceId']!=='string'||body['verified']!==true)throw new BadRequestException('Verified cash flow required');
      return writeJournal(request,body as unknown as JournalCommand);
    }
  }
  @Controller('sources')
  class SourceController {
    @Get('readiness') readiness(){return getReadiness(db)}
  }
  @Controller('system')
  class ScanController {
    @Get('scheduler') scheduler(){return schedulerStatus(db)}
    @Get('daily-structure/:id') async dailyStructure(@Param('id') id:string){
      if(!/^[0-9a-f]{64}$/.test(id))throw new BadRequestException('Invalid execution ID');
      const result=await getDailyStructure(db,id);if(!result)throw new NotFoundException('Daily execution not found');return result;
    }
    @Get('scan-jobs/:id') async scanJob(@Param('id') id:string){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw new BadRequestException('Invalid scan ID');
      const progress=await eodScanProgress(db,id);if(!progress)throw new NotFoundException('Scan job not found');return progress;
    }
    @Get('jobs') jobs(@Query('runId') runId?:string,@Query('after') after?:string,@Query('limit') limit?:string){
      for(const id of [runId,after])if(id!==undefined&&(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))throw new BadRequestException('Invalid job filter');
      if(limit!==undefined&&(typeof limit!=='string'||!/^\d+$/.test(limit)||Number(limit)<1||Number(limit)>200))throw new BadRequestException('Invalid job limit');
      return syncJobs(db,{...(runId?{runId}:{}),...(after?{after}:{}),...(limit?{limit:Number(limit)}:{})});
    }
    @Get('coverage/:listingId') coverage(@Param('listingId') listingId:string,@Query('provider') provider?:string){
      if(typeof listingId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(listingId)||typeof provider!=='string'||!provider.trim()||provider.length>100)throw new BadRequestException('Listing ID and provider required');
      return instrumentCoverage(db,listingId,provider);
    }
    @Get('data-gaps') async gaps(@Query('listingId') listingId?:string,@Query('provider') provider?:string){
      if(listingId!==undefined||provider!==undefined){if(!listingId)throw new BadRequestException('Listing ID required');return this.coverage(listingId,provider)}
      const scan=await latestScan(db);
      return scan?{scanId:scan.scanId,asOf:scan.asOf,dataRevision:scan.dataRevision,status:scan.status,counts:scan.counts,items:scan.entries.filter(x=>x.status!=='ANALYZED')}:{status:'UNKNOWN',reason:'NO_COMPLETED_SCAN',items:[],asOf:null,dataRevision:null};
    }
    @Get('scans/:id') async scan(@Param('id') id:string){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw new BadRequestException('Invalid scan ID');
      const scan=await getScan(db,id);if(!scan)throw new NotFoundException('Scan not found');return scan;
    }
  }
  @Module({controllers:[SystemController,AuthController,PatternController,CandidateController,ScanController,PositionController,PortfolioController,SourceController,WatchlistController],providers:[{provide:'database-lifecycle',useValue:{onModuleDestroy:()=>db.$disconnect()}}]})
  class AppModule {}
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.use((request: Request, response: Response & {statusCode:number;on:(name:string,callback:()=>void)=>void}, next: () => void) => {
    request.requestId = randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    response.setHeader('Cache-Control', 'no-store');
    withLogContext({requestId:request.requestId,...(options.logSink?{sink:options.logSink}:{})},()=>{
      const startedAt=new Date().toISOString(),context=logContext();let finished=false;
      writeLog('api.request',{startedAt,finishedAt:null,result:'STARTED'});
      const finish=(aborted:boolean)=>{if(finished)return;finished=true;const status=response.statusCode;writeLog('api.request',{startedAt,finishedAt:new Date().toISOString(),result:aborted||status>=400?'FAILED':'SUCCESS',failureCode:aborted?'REQUEST_ABORTED':status>=400?errorCodes[status as keyof typeof errorCodes]??'INTERNAL_ERROR':null,httpStatus:status},context,options.logSink)};
      response.on('finish',()=>finish(false));response.on('close',()=>finish(true));next();
    });
  });
  app.useGlobalFilters(new Errors());
  app.use((request:AuthRequest,response:AuthResponse,next:()=>void) => {
    if (['/api/v1/system/health','/api/v1/system/openapi.json','/api/v1/auth/login'].includes(request.path)) {next();return;}
    if (!request.path.startsWith('/api/v1/')) {next();return;}
    void auth.authenticate(request,!['GET','HEAD','OPTIONS'].includes(request.method)).then(()=>next()).catch((error:unknown)=>{
      const status=error instanceof HttpException?error.getStatus():503;
      response.status(status).json({error:{code:errorCodes[status as keyof typeof errorCodes]??'INTERNAL_ERROR',message:error instanceof HttpException?error.message:'Authentication store unavailable',details:null,requestId:request.requestId},at:new Date().toISOString()});
    });
  });
  app.enableShutdownHooks();
  return app;
}

