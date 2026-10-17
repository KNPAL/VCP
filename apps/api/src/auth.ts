import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BadRequestException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { PrismaClient, verifyPassword } from '@vcp/database';

export type AuthRequest = {
 method: string; path: string; headers: Record<string,string|string[]|undefined>; body?: unknown;
 ownerId?: string; requestId?: string;
};
export type AuthResponse = { setHeader(name:string,value:string):void; status(code:number):AuthResponse; json(value:unknown):void };
const digest = (s:string) => createHash('sha256').update(s).digest('hex');
function cookieToken(request:AuthRequest):string|undefined {
 const header = request.headers['cookie'];
 if(typeof header !== 'string') return undefined;
 const value = header.split(';').map(s=>s.trim()).find(s=>s.startsWith('vcp_session='))?.slice(12);
 return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
export class AuthService {
 private readonly attempts = new Map<string,{count:number;until:number}>();
 constructor(readonly db:PrismaClient, readonly origin:string, readonly secure=true, readonly now=()=>Date.now()) {
  if(!origin || new URL(origin).origin !== origin) throw new Error('APP_ORIGIN must be an exact origin');
  if(!secure && process.env['NODE_ENV'] === 'production') throw new Error('Production cookies must be secure');
 }
 private sameOrigin(request:AuthRequest) {
  if(request.headers['origin'] !== this.origin) throw new ForbiddenException('Invalid request origin');
 }
 private cookie(token:string,maxAge:number):string {
  return 'vcp_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge+(this.secure?'; Secure':'');
 }
 async login(request:AuthRequest,response:AuthResponse) {
  this.sameOrigin(request);
  const body=request.body as Record<string,unknown>|null;
  if(!body || Array.isArray(body) || Object.keys(body).some(k=>!['login','password'].includes(k)) || typeof body['login']!=='string' || typeof body['password']!=='string' || body['login'].length>200 || body['password'].length>256) throw new BadRequestException('Login and password required');
  // Global single-owner budget avoids bypass by varying login names or forwarded IPs.
  const prior=this.attempts.get('owner');
  if(prior && prior.until>this.now() && prior.count>=5) throw new HttpException('Too many login attempts',429);
  const budget=prior && prior.until>this.now()?prior:{count:0,until:this.now()+60000};
  budget.count++; this.attempts.set('owner',budget);
  const owner=await this.db.owner.findUnique({where:{login:body['login']}});
  const dummy='scrypt$00000000000000000000000000000000$'+'00'.repeat(64);
  const valid=await verifyPassword(body['password'],owner?.passwordHash??dummy);
  if(!owner || !valid || owner.role!=='OWNER') throw new UnauthorizedException('Invalid credentials');
  const token=randomBytes(32).toString('hex');
  const csrfToken=digest('csrf:'+token);
  await this.db.session.create({data:{id:digest(token),ownerId:owner.id,csrfHash:digest(csrfToken),expiresAt:new Date(this.now()+8*3600000)}});
  this.attempts.delete('owner');
  response.setHeader('Set-Cookie',this.cookie(token,8*3600));
  return {owner:{id:owner.id,login:owner.login,role:owner.role},csrfToken,expiresAt:new Date(this.now()+8*3600000).toISOString()};
 }
 async authenticate(request:AuthRequest,mutation=false) {
  const token=cookieToken(request);
  if(!token) throw new UnauthorizedException('Authentication required');
  const session=await this.db.session.findUnique({where:{id:digest(token)},include:{owner:true}});
  if(!session || session.expiresAt.valueOf()<=this.now()) throw new UnauthorizedException('Session expired');
  if(session.owner.role!=='OWNER') throw new ForbiddenException('Owner role required');
  const csrfToken=digest('csrf:'+token);
  if(mutation) {
   this.sameOrigin(request);
   const supplied=request.headers['x-csrf-token'];
   if(typeof supplied!=='string' || digest(supplied)!==session.csrfHash) throw new ForbiddenException('CSRF token required');
  }
  request.ownerId=session.ownerId;
  return {session,csrfToken};
 }
 async session(request:AuthRequest) {
  const {session,csrfToken}=await this.authenticate(request);
  return {owner:{id:session.ownerId,login:session.owner.login,role:session.owner.role},csrfToken,expiresAt:session.expiresAt.toISOString()};
 }
 async logout(request:AuthRequest,response:AuthResponse) {
  const {session}=await this.authenticate(request,true);
  await this.db.session.deleteMany({where:{id:session.id,ownerId:session.ownerId}});
  response.setHeader('Set-Cookie',this.cookie('',0));
  return {loggedOut:true};
 }
}
export async function databaseFromEnvironment() {
 if(process.env['DATABASE_PASSWORD_FILE']) {
  const password=(await readFile(process.env['DATABASE_PASSWORD_FILE'],'utf8')).trim();
  process.env['DATABASE_URL']='postgresql://vcp:'+encodeURIComponent(password)+'@'+(process.env['DATABASE_HOST']??'postgres')+':5432/vcp';
 }
 return new PrismaClient();
}
