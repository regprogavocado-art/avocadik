import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {configured,passwordHash,verifyPassword,loginChallenge,login,getSession,requireMutation,logout,validOrigin,digest} from '../src/lib/auth.ts';

function db() {const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001_cms.sql',import.meta.url),'utf8'));return {sqlite,DB:{prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this},async first(){return stmt.get(...args)||null},async run(){return stmt.run(...args)}}},async batch(stmts){for(const stmt of stmts)await stmt.run()}}};}
const secret='test-secret-must-be-at-least-32-characters';
const password='a unique long admin password';
const hash=await passwordHash(password);
const createForm=(csrf,pw=password)=>{const form=new FormData();form.set('csrf',csrf);form.set('password',pw);return form};
const request=(cookie='',origin='https://example.test')=>new Request('https://example.test/api/admin/login',{method:'POST',headers:{origin,cookie,'cf-connecting-ip':'192.0.2.1'}});

test('authentication fails closed without configured secrets or database',async()=>{
  assert.equal(configured({}),false);assert.equal(configured({DB:{},SESSION_SECRET:'short',ADMIN_PASSWORD_HASH:hash}),false);
  const response=await login(request(),{},createForm('x'));assert.equal(response.status,503);assert.equal(await getSession(request(),{}),null);
});

test('PBKDF2 hashes verify only the correct password',async()=>{
  assert.match(hash,/^pbkdf2-sha256\$100000\$[a-f0-9]{64}\$[a-f0-9]{64}$/);assert.equal(await verifyPassword(password,hash),true);assert.equal(await verifyPassword('incorrect',hash),false);assert.equal(await verifyPassword(password,'plaintext'),false);
});

test('successful login stores only token hash; expires and revokes sessions',async()=>{
  const {DB,sqlite}=db(),env={DB,SESSION_SECRET:secret,ADMIN_PASSWORD_HASH:hash};const challenge=loginChallenge(request());
  const response=await login(request(challenge.cookie.split(';')[0]),env,createForm(challenge.csrf));assert.equal(response.status,303);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
  const token=cookie.split(';')[0].split('=')[1],saved=sqlite.prepare('SELECT * FROM admin_sessions').get();assert.equal(saved.token_hash,await digest(token));assert.notEqual(saved.token_hash,token);
  const sessionRequest=request(cookie.split(';')[0]),session=await getSession(sessionRequest,env);assert.ok(session);
  const invalid=new FormData();invalid.set('csrf','invalid');assert.equal((await requireMutation(sessionRequest,env,invalid)).status,403);
  invalid.set('csrf',session.csrf);assert.equal((await requireMutation(sessionRequest,env,invalid)).csrf,session.csrf);
  const hostile=request(cookie.split(';')[0],'https://evil.test');assert.equal((await requireMutation(hostile,env,invalid)).status,403);
  sqlite.prepare('UPDATE admin_sessions SET expires_at=?').run(Date.now()-1);assert.equal(await getSession(sessionRequest,env),null);
  sqlite.prepare('UPDATE admin_sessions SET expires_at=?').run(Date.now()+60000);
  await logout(sessionRequest,env,session);assert.equal(await getSession(sessionRequest,env),null);
});

test('cross-origin and missing Origin requests fail; invalid login is rate limited atomically',async()=>{
  const {DB}=db(),env={DB,SESSION_SECRET:secret,ADMIN_PASSWORD_HASH:hash};const challenge=loginChallenge(request());const cookie=challenge.cookie.split(';')[0];
  assert.equal(validOrigin(new Request('https://example.test/api/admin/login')),false);
  assert.equal((await login(request(cookie,'https://evil.test'),env,createForm(challenge.csrf))).status,403);
  for(let i=0;i<5;i++)assert.equal((await login(request(cookie),env,createForm(challenge.csrf,'wrong'))).status,303);
  assert.equal((await login(request(cookie),env,createForm(challenge.csrf,password))).status,429);
});
