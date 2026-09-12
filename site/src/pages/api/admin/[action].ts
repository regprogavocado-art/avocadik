import type { APIRoute } from 'astro';
import type { Env } from '../../../lib/content';
import {getSession,login,logout,requireMutation,responseError} from '../../../lib/auth';
import {mutate} from '../../../lib/admin';
import { env as cloudflareEnv } from 'cloudflare:workers';
export const prerender=false;
export const POST:APIRoute=async ({request,params})=>{
  const env=cloudflareEnv as unknown as Env;
  const action=params.action||'';
  if(action!=='login'&&!await getSession(request,env))return responseError('Сессия завершена. Войдите снова.',401);
  const max=action==='upload'?9*1024*1024:128*1024;
  if(Number(request.headers.get('content-length')||0)>max)return responseError('Форма слишком большая.',413);
  // Bound chunked requests as well as requests carrying Content-Length.
  const reader=request.body?.getReader();if(!reader)return responseError('Пустая форма.');
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();return responseError('Форма слишком большая.',413)}chunks.push(value)}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  let form:FormData;try {form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData()}catch{return responseError('Не удалось прочитать форму.')}
  if(action==='login')return login(request,env,form);
  const session=await requireMutation(request,env,form);if(session instanceof Response)return session;
  if(action==='logout')return logout(request,env,session);
  return mutate(action,request,env,form,session);
};
