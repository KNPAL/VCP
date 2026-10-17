import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Catch, Controller, Get, Post, Param, Query, Req, Res, HttpException, Module, BadRequestException, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter, PipeTransform } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { STRATEGY_VERSION, errorCodes, wireSchemas, InputError } from '@vcp/domain';
import { AuthService, databaseFromEnvironment } from './auth.js';
import type { AuthRequest, AuthResponse } from './auth.js';
import type { PrismaClient } from '@vcp/database';
import {getScan,latestScan,appendPortfolio,readPortfolio} from '@vcp/database';
import type {JournalCommand} from '@vcp/database';
import {candidatePage} from '@vcp/strategy';

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
    '/api/v1/system/data-gaps': {get:{operationId:'dataGaps',security:[{session:[]}],responses:{'200':{description:'Latest scan missing and excluded listings, or explicit NO_COMPLETED_SCAN UNKNOWN state'}}}},
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
export async function createApp(options: {db?:PrismaClient;origin?:string;secure?:boolean} = {}) {
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
    @Get() async portfolio(@Req() request:AuthRequest){const journal=await readPortfolio(db,request.ownerId!);return {...journal,equity:null,reconciliation:'UNKNOWN',reasons:[...journal.reasons,'VERIFIED_MARKS_REQUIRED','RECONCILIATION_REQUIRED']}}
    @Post('cash') cash(@Req() request:AuthRequest){
      const body=strictBody(request,['kind','amount','verified','occurredAt','sourceId']);
      if(!['INITIAL_CAPITAL','DEPOSIT','WITHDRAWAL','FEE','DIVIDEND','CORPORATE_CREDIT','CORPORATE_DEBIT'].includes(String(body['kind']))||typeof body['amount']!=='string'||typeof body['occurredAt']!=='string'||typeof body['sourceId']!=='string'||body['verified']!==true)throw new BadRequestException('Verified cash flow required');
      return writeJournal(request,body as unknown as JournalCommand);
    }
  }
  @Controller('system')
  class ScanController {
    @Get('data-gaps') async gaps(){
      const scan=await latestScan(db);
      return scan?{scanId:scan.scanId,asOf:scan.asOf,dataRevision:scan.dataRevision,status:scan.status,counts:scan.counts,items:scan.entries.filter(x=>x.status!=='ANALYZED')}:{status:'UNKNOWN',reason:'NO_COMPLETED_SCAN',items:[],asOf:null,dataRevision:null};
    }
    @Get('scans/:id') async scan(@Param('id') id:string){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw new BadRequestException('Invalid scan ID');
      const scan=await getScan(db,id);if(!scan)throw new NotFoundException('Scan not found');return scan;
    }
  }
  @Module({controllers:[SystemController,AuthController,PatternController,CandidateController,ScanController,PositionController,PortfolioController],providers:[{provide:'database-lifecycle',useValue:{onModuleDestroy:()=>db.$disconnect()}}]})
  class AppModule {}
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.use((request: Request, response: Response, next: () => void) => {
    request.requestId = randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    response.setHeader('Cache-Control', 'no-store');
    next();
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
