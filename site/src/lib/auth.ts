import type { Env } from './content';
const SESSION_COOKIE='avocado_admin';
const LOGIN_COOKIE='avocado_login';
const SESSION_AGE=8*60*60*1000;
const enc=new TextEncoder();
export type AdminSession={token_hash:string;csrf:string;expires_at:number};
export function configured(env:Env) {return !!env.DB && typeof env.SESSION_SECRET==='string' && env.SESSION_SECRET.length>=32 && /^pbkdf2-sha256\$100000\$[a-f0-9]{32,128}\$[a-f0-9]{64}$/i.test(env.ADMIN_PASSWORD_HASH||'');}
export function randomHex(bytes=32) {return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
function toBytes(hex:string) {return Uint8Array.from(hex.match(/.{2}/g)||[],v=>parseInt(v,16));}
export async function digest(value:string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
export function constantTimeEqual(a:string,b:string) {let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++) diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
/** Format: pbkdf2-sha256$100000$<32-byte salt hex>$<32-byte derived key hex>.
 * Cloudflare WebCrypto supports at most 100,000 PBKDF2 iterations. Use a unique
 * password of >=16 characters; no plaintext password is accepted in config. */
export async function passwordHash(password:string,salt=randomHex(32)) {
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:toBytes(salt)},key,256);
  return `pbkdf2-sha256$100000$${salt}$${Array.from(new Uint8Array(bits),v=>v.toString(16).padStart(2,'0')).join('')}`;
}
export async function verifyPassword(password:string,hash:string) {if(password.length>256||!/^pbkdf2-sha256\$100000\$[a-f0-9]{32,128}\$[a-f0-9]{64}$/i.test(hash))return false;const computed=await passwordHash(password,hash.split('$')[2]);return constantTimeEqual(computed,hash);}
function readCookie(request:Request,name:string) {for(const part of (request.headers.get('cookie')||'').split(';')) {const [key,...value]=part.trim().split('=');if(key===name)return value.join('=');}return '';}
function cookie(name:string,value:string,request:Request,maxAge:number) {const u=new URL(request.url);const local=u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname);return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${local?'':'; Secure'}`;}
export function secureHeaders(extra:Record<string,string>={}) {return {'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",...extra};}
export function responseError(message:string,status=400) {return new Response(message,{status,headers:secureHeaders({'Content-Type':'text/plain; charset=utf-8'})});}
export function redirect(path:string,_request:Request,cookieValue?:string) {const headers:Record<string,string>=secureHeaders({Location:path});if(cookieValue)headers['Set-Cookie']=cookieValue;return new Response(null,{status:303,headers});}
export function validOrigin(request:Request) {const origin=request.headers.get('origin');return !!origin&&origin===new URL(request.url).origin;}
export async function getSession(request:Request,env:Env):Promise<AdminSession|null> {
  if(!configured(env))return null;
  const token=readCookie(request,SESSION_COOKIE);if(!/^[a-f0-9]{64}$/.test(token))return null;
  const hash=await digest(token);
  return env.DB!.prepare('SELECT token_hash,csrf,expires_at FROM admin_sessions WHERE token_hash=? AND expires_at>?').bind(hash,Date.now()).first<AdminSession>();
}
export function loginChallenge(request:Request) {const csrf=randomHex();return {csrf,cookie:cookie(LOGIN_COOKIE,csrf,request,900)};}
export async function login(request:Request,env:Env,form:FormData) {
  if(!configured(env))return responseError('Вход недоступен. Настройте базу, хеш пароля и секрет сессий.',503);
  if(!validOrigin(request))return responseError('Запрос с другого сайта отклонён.',403);
  const csrf=String(form.get('csrf')||'');const challenge=readCookie(request,LOGIN_COOKIE);
  if(!/^[a-f0-9]{64}$/.test(csrf)||!constantTimeEqual(csrf,challenge))return responseError('Форма устарела. Обновите страницу входа.',403);
  const now=Date.now(),windowStart=Math.floor(now/900000)*900000;
  const ipHash=await digest(`${env.SESSION_SECRET}:${request.headers.get('cf-connecting-ip')||'local'}`);
  const attempt=await env.DB!.prepare('INSERT INTO admin_login_attempts(ip_hash,window_start,attempts) VALUES(?,?,1) ON CONFLICT(ip_hash,window_start) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(ipHash,windowStart).first<{attempts:number}>();
  if(!attempt||attempt.attempts>5)return responseError('Слишком много попыток. Повторите через 15 минут.',429);
  if(!await verifyPassword(String(form.get('password')||''),env.ADMIN_PASSWORD_HASH!))return redirect('/admin/login?error=credentials',request);
  const token=randomHex(),tokenHash=await digest(token),csrfToken=randomHex();
  await env.DB!.batch([
    env.DB!.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now),
    env.DB!.prepare('DELETE FROM admin_login_attempts WHERE window_start<?').bind(windowStart-900000),
    env.DB!.prepare('INSERT INTO admin_sessions(token_hash,csrf,created_at,expires_at) VALUES(?,?,?,?)').bind(tokenHash,csrfToken,now,now+SESSION_AGE)
  ]);
  return redirect('/admin',request,cookie(SESSION_COOKIE,token,request,SESSION_AGE/1000));
}
export async function requireMutation(request:Request,env:Env,form:FormData):Promise<AdminSession|Response> {
  if(!validOrigin(request))return responseError('Запрос с другого сайта отклонён.',403);
  const session=await getSession(request,env);if(!session)return responseError('Сессия завершена. Войдите снова.',401);
  if(!constantTimeEqual(String(form.get('csrf')||''),session.csrf))return responseError('Форма устарела. Обновите страницу.',403);
  return session;
}
export async function logout(request:Request,env:Env,session:AdminSession) {await env.DB!.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(session.token_hash).run();return redirect('/admin/login',request,cookie(SESSION_COOKIE,'',request,0));}
