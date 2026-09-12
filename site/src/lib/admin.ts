import {categories,getSettings,mapProduct,pricePeriods,safeSourceUrl,validSourceDate,type Env,type Wallet} from './content.ts';
import {responseError,redirect,type AdminSession} from './auth.ts';
import {reservedPageSlugs} from './public-route-rules.mjs';
export class ValidationError extends Error {}
function fail(message:string):never {throw new ValidationError(message)}
export function field(form:FormData,key:string,max=1000,required=false) {const value=String(form.get(key)||'').trim();if(value.length>max)fail(`Поле «${key}» слишком длинное.`);if(required&&!value)fail('Заполните обязательные поля.');return value;}
function choice(form:FormData,key:string,values:string[]) {const value=field(form,key,50,true);if(!values.includes(value))fail('Недопустимое значение поля.');return value;}
function numberId(form:FormData) {const value=field(form,'id',20);if(value&&!/^[1-9]\d*$/.test(value))fail('Некорректный номер записи.');return value?Number(value):null;}
function slug(form:FormData) {const value=field(form,'slug',80,true);if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))fail('Адрес: только строчные латинские буквы, цифры и дефис.');return value;}
export function validAmount(value:string) {return /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/.test(value)&&/[1-9]/.test(value);}
function imagePath(value:string) {if(value&&!/^\/(?:assets\/img|media)\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpe?g)$/.test(value))fail('Картинка должна быть загружена на сайт: /media/… или /assets/img/….');return value;}
function mediaKey(value:string) {const key=value.replace(/^\/media\//,'');if(key&&!/^[a-zA-Z0-9/_-]+\.(?:webp|png|jpe?g)$/.test(key))fail('Некорректный путь к изображению.');return key;}
export const navItems=[['','Обзор'],['pages','Страницы'],['products','Услуги'],['countries','Страны'],['news','Новости'],['chats','Заявки'],['invoices','Счета'],['settings','Настройки']];
async function audit(env:Env,action:string,entity:string,id:string) {await env.DB!.prepare('INSERT INTO admin_audit(action,entity,entity_id,created_at) VALUES(?,?,?,?)').bind(action,entity,id,Date.now()).run();}
async function saveRecord(env:Env,table:string,id:number|null,values:Record<string,any>) {
  const keys=Object.keys(values),now=Date.now();
  if(id){const found=await env.DB!.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(id).first();if(!found)fail('Запись не найдена.');await env.DB!.prepare(`UPDATE ${table} SET ${keys.map(k=>`${k}=?`).join(',')},updated_at=? WHERE id=?`).bind(...Object.values(values),now,id).run();}
  else await env.DB!.prepare(`INSERT INTO ${table}(${keys.join(',')},created_at,updated_at) VALUES(${keys.map(()=>'?').join(',')},?,?)`).bind(...Object.values(values),now,now).run();
}
async function setSetting(env:Env,key:string,value:string) {await env.DB!.prepare('INSERT INTO cms_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,value,Date.now()).run();}
export function sniffImage(bytes:Uint8Array):{type:string,extension:string}|null {
  if(bytes.length<12)return null;
  if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return {type:'image/png',extension:'png'};
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {type:'image/jpeg',extension:'jpg'};
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return {type:'image/webp',extension:'webp'};
  return null;
}
export async function mutate(action:string,request:Request,env:Env,form:FormData,_session:AdminSession):Promise<Response> {
  let back=action==='wallet'?'settings':action;
  try {
    if(action==='pages') {
      const pageSlug=slug(form);if(reservedPageSlugs.includes(pageSlug))fail('Этот адрес зарезервирован.');
      await saveRecord(env,'cms_pages',numberId(form),{slug:pageSlug,title:field(form,'title',150,true),summary:field(form,'summary',500),body:field(form,'body',30000),status:choice(form,'status',['published','draft'])});
    } else if(action==='products') {
      const price=field(form,'price',50);if(price&&!validAmount(price))fail('Цена должна быть положительным десятичным числом через точку или пустой.');
      const codes=form.getAll('countryCodes').map(String);if(codes.length>250)fail('Слишком много стран.');
      const rows=await env.DB!.prepare('SELECT code FROM cms_countries').all<{code:string}>();const allowed=new Set(rows.results.map(r=>r.code));if(codes.some(c=>!allowed.has(c)))fail('Выберите страны из списка.');
      const currency=field(form,'priceCurrency',12,true).toUpperCase();if(!/^[A-Z0-9]{2,12}$/.test(currency))fail('Укажите код валюты, например USD.');
      const period=field(form,'pricePeriod',20);if(period&&!pricePeriods.includes(period as any))fail('Выберите период цены из списка.');
      const source=field(form,'sourceUrl',1000);const sourceUrl=source?safeSourceUrl(source):'';if(source&&!sourceUrl)fail('Источник должен быть полной HTTPS-ссылкой без логина и пароля.');
      const checkedAt=field(form,'sourceCheckedAt',10);if(checkedAt&&!validSourceDate(checkedAt))fail('Дата проверки источника: ГГГГ-ММ-ДД.');
      await saveRecord(env,'cms_products',numberId(form),{slug:slug(form),title:field(form,'title',150,true),category:choice(form,'category',categories.map(c=>c.id)),summary:field(form,'summary',500),body:field(form,'body',30000),price,price_currency:currency,price_period:period,price_note:field(form,'priceNote',200),source_name:field(form,'sourceName',100),source_url:sourceUrl||'',source_checked_at:checkedAt,availability:choice(form,'availability',['available','on_request','soon']),country_codes:JSON.stringify([...new Set(codes)]),image:imagePath(field(form,'image',300)),status:choice(form,'status',['published','draft'])});
    } else if(action==='countries') {
      const code=field(form,'code',2,true).toUpperCase();if(!/^[A-Z]{2}$/.test(code))fail('Код страны состоит из двух латинских букв.');
      await saveRecord(env,'cms_countries',numberId(form),{code,name:field(form,'name',100,true),status:choice(form,'status',['published','draft'])});
    } else if(action==='news') {
      const id=numberId(form);const existing=id?await env.DB!.prepare('SELECT source FROM news WHERE id=?').bind(id).first<{source:string}>():null;
      const date=field(form,'publishedAt',30,true);const timestamp=Date.parse(date);if(!Number.isFinite(timestamp))fail('Укажите дату публикации.');
      await saveRecord(env,'news',id,{slug:slug(form),title:field(form,'title',200,true),body:field(form,'body',30000,true),excerpt:field(form,'excerpt',500),media_key:mediaKey(field(form,'mediaKey',300)),published_at:timestamp,hidden:form.has('hidden')?1:0,pinned:form.has('pinned')?1:0,manual_override:existing?.source==='telegram'?(form.has('manualOverride')?1:0):0,...(!id?{source:'manual'}:{})});
    } else if(action==='settings') {
      const telegramUrl=field(form,'telegramUrl',200);if(telegramUrl&&!/^https:\/\/t\.me\/[a-zA-Z0-9_]{5,32}$/.test(telegramUrl))fail('Ссылка Telegram должна иметь вид https://t.me/name.');
      const email=field(form,'email',200);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Проверьте адрес электронной почты.');
      // Chat origin is deployment configuration, not an editable browser endpoint.
      await env.DB!.batch(Object.entries({telegramUrl,email,paymentTerms:field(form,'paymentTerms',20000),refundTerms:field(form,'refundTerms',20000)}).map(([key,value])=>env.DB!.prepare('INSERT INTO cms_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,value,Date.now())));
    } else if(action==='wallet') {
      const settings=await getSettings(env);const id=field(form,'id',80)||crypto.randomUUID();if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))fail('Некорректный номер кошелька.');
      const currency=field(form,'currency',12,true).toUpperCase();if(!/^[A-Z0-9]{2,12}$/.test(currency))fail('Проверьте код криптовалюты.');
      const address=field(form,'address',256,true);if(!/^[a-zA-Z0-9:_-]{8,256}$/.test(address))fail('Адрес кошелька должен быть без пробелов.');
      const wallet:Wallet={id,currency,address,network:field(form,'network',60,true),label:field(form,'label',100),enabled:form.has('enabled')};
      const index=settings.wallets.findIndex(w=>w.id===id);if(index>=0)settings.wallets[index]=wallet;else settings.wallets.push(wallet);
      if(settings.wallets.length>100)fail('Допускается не более 100 кошельков.');
      await setSetting(env,'wallets',JSON.stringify(settings.wallets));
    } else if(action==='invoices') {
      const walletId=field(form,'walletId',80,true),settings=await getSettings(env),wallet=settings.wallets.find(w=>w.id===walletId&&w.enabled);if(!wallet)fail('Выберите активный кошелёк в настройках.');
      const amount=field(form,'amount',50,true);if(!validAmount(amount))fail('Сумма должна быть положительной, до 18 знаков после точки.');
      const sessionId=field(form,'sessionId',128);if(sessionId&&!await env.DB!.prepare('SELECT id FROM sessions WHERE id=?').bind(sessionId).first())fail('Диалог не найден.');
      await env.DB!.prepare('INSERT INTO invoices(id,session_id,description,amount,currency,network,address,wallet_id,memo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),sessionId,field(form,'description',500,true),amount,wallet.currency,wallet.network,wallet.address,wallet.id,field(form,'memo',1000),Date.now(),Date.now()).run();
    } else if(action==='invoice-status') {
      back='invoices';const id=field(form,'id',80,true),status=choice(form,'status',['paid','fulfilled','cancelled']);
      const invoice=await env.DB!.prepare('SELECT * FROM invoices WHERE id=?').bind(id).first();if(!invoice)fail('Счёт не найден.');
      const transition=invoice.status==='pending'&&['paid','cancelled'].includes(status)||invoice.status==='paid'&&status==='fulfilled';if(!transition)fail('Недопустимый переход статуса счёта.');
      const tx=status==='paid'?field(form,'transactionId',256,true):invoice.transaction_id;
      const now=Date.now();const result=await env.DB!.prepare('UPDATE invoices SET status=?,transaction_id=?,updated_at=?,paid_at=?,fulfilled_at=? WHERE id=? AND status=?').bind(status,tx,now,status==='paid'?now:invoice.paid_at,status==='fulfilled'?now:invoice.fulfilled_at,id,invoice.status).run();
      if(result.meta?.changes===0)fail('Статус счёта уже изменился. Обновите страницу.');
    } else if(action==='reply') {
      const sid=field(form,'sessionId',128,true),text=field(form,'text',4096,true);back=`chats/${encodeURIComponent(sid)}`;
      if(!env.ADMIN_API_SECRET||env.ADMIN_API_SECRET.length<32)fail('Секрет связи с ботом ещё не настроен.');
      const path=`/api/internal/chat/${encodeURIComponent(sid)}/reply`;
      const options={method:'POST',headers:{'Content-Type':'application/json','X-Admin-Api-Key':env.ADMIN_API_SECRET},body:JSON.stringify({text})};
      let result:Response;
      const localTarget=env.CHAT_WORKER_URL?new URL(env.CHAT_WORKER_URL):null;
      if(localTarget&&localTarget.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(localTarget.hostname))result=await fetch(new URL(path,localTarget),options);
      else if(env.CHAT_SERVICE)result=await env.CHAT_SERVICE.fetch(`https://chat.internal${path}`,options);
      else if(env.CHAT_WORKER_URL&&/^https:\/\/[a-zA-Z0-9.-]+\/?$/.test(env.CHAT_WORKER_URL))result=await fetch(new URL(path,env.CHAT_WORKER_URL),options);
      else fail('Связь с ботом ещё не настроена.');
      if(!result!.ok)fail(result!.status===404?'Диалог не найден.':'Не удалось сохранить ответ. Проверьте связь с ботом.');
      const payload=await result!.json() as {delivered?:boolean};
      await audit(env,'reply','chat',sid);
      return redirect(`/admin/${back}?${payload.delivered===false?'warning=delivery':'saved=1'}`,request);
    } else if(action==='upload') {
      if(!env.NEWS_MEDIA)fail('Хранилище изображений ещё не настроено.');
      const file=form.get('file');if(!file||typeof file==='string'||file.size===0||file.size>8*1024*1024)fail('Выберите PNG, JPEG или WebP размером до 8 МБ.');
      const bytes=new Uint8Array(await (file as File).arrayBuffer()),kind=sniffImage(bytes);if(!kind)fail('Разрешены только PNG, JPEG и WebP.');
      const key=`uploads/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${kind!.extension}`;
      await env.NEWS_MEDIA.put(key,bytes,{httpMetadata:{contentType:kind!.type,cacheControl:'public, max-age=31536000, immutable'}});
      await audit(env,'upload','media',key);
      return redirect(`/admin/news?uploaded=${encodeURIComponent(`/media/${key}`)}`,request);
    } else return responseError('Действие не найдено.',404);
    await audit(env,'save',action,field(form,'id',80));
    return redirect(`/admin/${back}?saved=1`,request);
  } catch(error) {
    if(error instanceof ValidationError)return redirect(`/admin/${back.split('/')[0]}?error=${encodeURIComponent(error.message)}`,request);
    // Never return SQL, credentials or upstream payloads to the browser.
    if(error instanceof Error&&/UNIQUE constraint failed/.test(error.message))return redirect(`/admin/${back.split('/')[0]}?error=${encodeURIComponent('Такой адрес или код уже используется. Выберите другой.')}`,request);
    console.error('Admin operation failed',{action,errorType:error instanceof Error?error.name:'unknown'});
    return responseError('Изменения не подтверждены. Обновите страницу и проверьте запись перед повторной отправкой.',503);
  }
}

export const escape=(value:any)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const attr=escape;
function hidden(name:string,value:any){return `<input type="hidden" name="${attr(name)}" value="${attr(value)}">`;}
function input(name:string,label:string,value:any='',options:{required?:boolean;type?:string;max?:number;hint?:string}={}) {const id=`field-${crypto.randomUUID()}`;return `<label><span id="${id}-label">${escape(label)}</span><input name="${attr(name)}" type="${options.type||'text'}" value="${attr(value)}" aria-labelledby="${id}-label" ${options.hint?`aria-describedby="${id}-hint"`:''} ${options.required?'required':''} maxlength="${options.max||500}" ${options.type==='password'?'autocomplete="current-password"':''}>${options.hint?`<small id="${id}-hint">${escape(options.hint)}</small>`:''}</label>`;}
function textarea(name:string,label:string,value:any='',required=false){const id=`field-${crypto.randomUUID()}`;return `<label><span id="${id}-label">${escape(label)}</span><textarea name="${attr(name)}" aria-labelledby="${id}-label" rows="6" maxlength="30000" ${required?'required':''}>${escape(value)}</textarea></label>`;}
function select(name:string,label:string,value:any,choices:{id:string;title:string}[]) {const id=`field-${crypto.randomUUID()}`;return `<label><span id="${id}-label">${escape(label)}</span><select name="${attr(name)}" aria-labelledby="${id}-label">${choices.map(c=>`<option value="${attr(c.id)}" ${c.id===value?'selected':''}>${escape(c.title)}</option>`).join('')}</select></label>`;}
function check(name:string,label:string,checked:boolean,value?:string){return `<label class="check"><input type="checkbox" name="${attr(name)}" ${checked?'checked':''} ${value?`value="${attr(value)}"`:''}>${escape(label)}</label>`;}
function form(action:string,csrf:string,body:string,button='Сохранить',extra='') {return `<form method="post" action="/api/admin/${action}" ${extra}>${hidden('csrf',csrf)}${body}<button class="button" type="submit">${escape(button)}</button></form>`;}
function panel(title:string,body:string){return `<section class="panel"><h2>${escape(title)}</h2>${body}</section>`;}
const publication=[{id:'draft',title:'Черновик — скрыто на сайте'},{id:'published',title:'Опубликовано'}];
const date=(ms:number)=>new Date(ms).toLocaleString('ru-RU',{timeZone:'UTC'});
const iso=(ms:number)=>new Date(ms).toISOString().slice(0,16)+'Z';
const stateLabels:Record<string,string>={published:'Опубликовано',draft:'Черновик',available:'В наличии',on_request:'По запросу',soon:'Скоро',pending:'Ожидает оплаты',paid:'Оплачен',fulfilled:'Выдан',cancelled:'Отменён'};
function table(headers:string[],rows:string[][],className=''){return rows.length?`<div class="table-scroll"><table class="${escape(className)}"><thead><tr>${headers.map(h=>`<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="muted">Записей пока нет.</p>';}
function pagination(section:string,current:number,hasNext:boolean){return current>1||hasNext?`<nav class="pagination" aria-label="Страницы списка">${current>1?`<a class="text-link" href="/admin/${section}?page=${current-1}">Назад</a>`:''}<span>Страница ${current}</span>${hasNext?`<a class="text-link" href="/admin/${section}?page=${current+1}">Дальше</a>`:''}</nav>`:'';}
const edit=(section:string,id:any)=>`<a class="text-link" href="/admin/${section}?edit=${encodeURIComponent(id)}">Открыть</a>`;
const badge=(value:string)=>`<span class="badge">${escape(stateLabels[value]||value)}</span>`;
export async function renderAdmin(section:string,env:Env,session:AdminSession,url:URL):Promise<{title:string;html:string}> {
  const csrf=session.csrf,db=env.DB!,editing=url.searchParams.get('edit'),page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page'))||1))),pageSize=50;let title=navItems.find(n=>n[0]===section)?.[1]||'Диалог',html='';
  if(!section) {
    const [pages,products,news,invoices]=await Promise.all(['cms_pages','cms_products','news','invoices'].map(t=>db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{n:number}>()));
    html=`<div class="stats">${[['Страницы',pages?.n,'pages'],['Услуги',products?.n,'products'],['Новости',news?.n,'news'],['Счета',invoices?.n,'invoices']].map(([label,n,path])=>`<a class="stat" href="/admin/${path}"><span>${label}</span><b>${n||0}</b></a>`).join('')}</div>`;
    html+=panel('Рабочий день',`<p>Обрабатывайте заявки, обновляйте наличие и публикуйте новости. Изменения появляются на сайте после сохранения.</p><div class="actions"><a class="button" href="/admin/chats">Открыть заявки</a><a class="button secondary" href="/admin/news">Добавить новость</a></div>`);
    const settings=await getSettings(env);if(!settings.wallets.some(w=>w.enabled))html+=panel('Приём оплаты',`<p>Добавьте адреса и сети в настройках, чтобы выставлять счета. Каждый счёт сохранит свои реквизиты.</p><a class="text-link" href="/admin/settings">Настроить кошельки</a>`);
  } else if(section==='pages') {
    const rows=(await db.prepare('SELECT * FROM cms_pages ORDER BY id').all()).results,record=rows.find(r=>String(r.id)===editing)||{};
    html=panel('Страницы сайта',table(['Название','Адрес','Статус',''],rows.map(r=>[escape(r.title),`/${escape(r.slug)}`,badge(r.status),edit(section,r.id)])));
    html+=panel(record.id?'Редактировать страницу':'Новая страница',form(section,csrf,hidden('id',record.id)+input('title','Название',record.title,{required:true,max:150})+input('slug','Адрес страницы',record.slug,{required:true,max:80,hint:'Например: hass. Только латиница, цифры и дефис.'})+input('summary','Краткое описание',record.summary)+textarea('body','Текст страницы',record.body)+select('status','Публикация',record.status||'draft',publication)));
  } else if(section==='products') {
    const [result,countryResult]=await Promise.all([db.prepare('SELECT * FROM cms_products ORDER BY id').all(),db.prepare('SELECT * FROM cms_countries ORDER BY name').all()]);const rows=result.results.map(mapProduct),record=rows.find(r=>String(r.id)===editing);
    html=panel('Товары и услуги',table(['Название','Категория','Наличие','Публикация',''],rows.map(r=>[escape(r.title),escape(categories.find(c=>c.id===r.category)?.title),badge(r.availability),badge(r.status),edit(section,r.id)])));
    const pricing=`<div class="form-grid">${input('price','Цена',record?.price,{hint:'Оставьте пустым для «по запросу». Дробная часть через точку.'})}${input('priceCurrency','Валюта цены',record?.priceCurrency||'USD',{required:true,max:12,hint:'Например USD или EUR. Без пересчёта валют.'})}</div>`
      +select('pricePeriod','Период цены',record?.pricePeriod||'',[{id:'',title:'Не указан'},{id:'month',title:'Месяц'},{id:'year',title:'Год'},{id:'30_days',title:'30 дней'},{id:'once',title:'Разово'}])
      +input('priceNote','Примечание к цене',record?.priceNote,{max:200,hint:'Например: за 1 IP; первый год; предварительный ориентир.'})
      +`<fieldset><legend>Закупочный источник · только для администратора</legend>${input('sourceName','Название источника',record?.sourceName,{max:100})}${input('sourceUrl','Ссылка на источник',record?.sourceUrl,{max:1000,type:'url',hint:'Официальная HTTPS-страница тарифа. Не показывается посетителям.'})}${input('sourceCheckedAt','Дата проверки источника',record?.sourceCheckedAt,{type:'date',max:10})}</fieldset>`;
    html+=panel(record?'Редактировать услугу':'Новая услуга',form(section,csrf,hidden('id',record?.id)+input('title','Название',record?.title,{required:true,max:150})+input('slug','Адрес',record?.slug,{required:true,max:80})+select('category','Категория',record?.category||'domains',categories)+input('summary','Краткое описание',record?.summary)+textarea('body','Описание',record?.body)+pricing+select('availability','Наличие',record?.availability||'on_request',[{id:'available',title:'В наличии'},{id:'on_request',title:'По запросу'},{id:'soon',title:'Скоро'}])+`<fieldset><legend>Страны</legend>${countryResult.results.length?countryResult.results.map(c=>check('countryCodes',c.name,!!record?.countryCodes.includes(c.code),c.code)).join(''):'<p class="muted">Сначала добавьте страны в соответствующем разделе.</p>'}</fieldset>`+input('image','Путь к изображению',record?.image,{hint:'Загрузите картинку в разделе «Новости» и скопируйте путь /media/….'})+select('status','Публикация',record?.status||'draft',publication)));
  } else if(section==='countries') {
    const rows=(await db.prepare('SELECT * FROM cms_countries ORDER BY name').all()).results,record=rows.find(r=>String(r.id)===editing)||{};
    html=panel('Страны',table(['Страна','Код','Публикация',''],rows.map(r=>[escape(r.name),escape(r.code),badge(r.status),edit(section,r.id)])));
    html+=panel(record.id?'Редактировать страну':'Добавить страну',form(section,csrf,hidden('id',record.id)+input('name','Название страны',record.name,{required:true,max:100})+input('code','Код из двух букв',record.code,{required:true,max:2,hint:'Код ISO 3166-1, например DE.'})+select('status','Публикация',record.status||'draft',publication)));
  } else if(section==='news') {
    const result=(await db.prepare('SELECT * FROM news ORDER BY pinned DESC,published_at DESC,id DESC LIMIT ? OFFSET ?').bind(pageSize+1,(page-1)*pageSize).all()).results;const rows=result.slice(0,pageSize);const record=editing?await db.prepare('SELECT * FROM news WHERE id=?').bind(editing).first()||{}:{};
    html=panel('Публикации',table(['Название','Источник','Публикация',''],rows.map(r=>[escape(r.title),r.source==='telegram'?'Telegram':'Вручную',badge(r.hidden?'Скрыта':r.published_at>Date.now()?'Запланирована':r.pinned?'Закреплена':'На сайте'),edit(section,r.id)]))+pagination(section,page,result.length>pageSize));
    html+=panel(record.id?'Редактировать новость':'Новая новость',form(section,csrf,hidden('id',record.id)+input('title','Заголовок',record.title,{required:true,max:200})+input('slug','Адрес новости',record.slug,{required:true,max:80})+input('excerpt','Краткое описание',record.excerpt)+textarea('body','Текст новости',record.body,true)+input('mediaKey','Путь к изображению',record.media_key?`/media/${record.media_key}`:url.searchParams.get('uploaded')||'',{hint:'Путь /media/… из формы загрузки ниже. Можно оставить пустым.'})+input('publishedAt','Дата и время публикации (UTC)',iso(record.published_at||Date.now()),{required:true,hint:'Формат: 2026-09-12T12:00Z. Будущая дата отложит публикацию.'})+check('hidden','Скрыть с сайта',!!record.hidden)+check('pinned','Закрепить в начале списка',!!record.pinned)+(record.source==='telegram'?check('manualOverride','Сохранить ручные правки при обновлении поста в Telegram',true):'')));
    html+=panel('Загрузить изображение',form('upload',csrf,'<label>PNG, JPEG или WebP, до 8 МБ<input type="file" name="file" accept="image/png,image/jpeg,image/webp" required></label>','Загрузить','enctype="multipart/form-data"'));
  } else if(section==='settings') {
    const settings=await getSettings(env);
    html=panel('Контакты и условия',form(section,csrf,input('telegramUrl','Telegram',settings.telegramUrl)+input('email','Электронная почта',settings.email,{type:'email'})+textarea('paymentTerms','Условия оплаты',settings.paymentTerms)+textarea('refundTerms','Условия возврата',settings.refundTerms)));
    html+=panel('Кошельки',`<p class="muted">Проверьте сеть и адрес перед включением. Изменения не затронут ранее выписанные счета.</p>`+settings.wallets.map(w=>`<details><summary>${escape(w.label||`${w.currency} · ${w.network}`)} — ${w.enabled?'включён':'выключен'}</summary>${walletForm(w,csrf)}</details>`).join(''));
    html+=panel('Добавить кошелёк',walletForm(undefined,csrf));
  } else if(section==='invoices') {
    const [rows,settings]=await Promise.all([db.prepare('SELECT * FROM invoices ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(pageSize+1,(page-1)*pageSize).all(),getSettings(env)]);
    const record=editing?await db.prepare('SELECT * FROM invoices WHERE id=?').bind(editing).first():null;
    html=panel('Счета',table(['Услуга','Сумма','Статус','Создан',''],rows.results.slice(0,pageSize).map(r=>[escape(r.description),`${escape(r.amount)} ${escape(r.currency)}`,badge(r.status),escape(date(r.created_at)),edit(section,r.id)]),'invoice-table')+pagination(section,page,rows.results.length>pageSize));
    if(record){html+=panel('Счёт',`<dl class="details"><dt>Номер</dt><dd>${escape(record.id)}</dd><dt>Услуга</dt><dd>${escape(record.description)}</dd><dt>Сумма</dt><dd>${escape(record.amount)} ${escape(record.currency)}</dd><dt>Сеть</dt><dd>${escape(record.network)}</dd><dt>Адрес</dt><dd class="mono">${escape(record.address)}</dd><dt>Примечание</dt><dd>${escape(record.memo||'—')}</dd><dt>Статус</dt><dd>${badge(record.status)}</dd><dt>Транзакция</dt><dd class="mono">${escape(record.transaction_id||'—')}</dd></dl>${record.session_id?`<a class="text-link" href="/admin/chats/${encodeURIComponent(record.session_id)}">Открыть диалог</a>`:''}`);
      if(record.status==='pending')html+=panel('Подтверждение оплаты',form('invoice-status',csrf,hidden('id',record.id)+hidden('status','paid')+input('transactionId','Идентификатор проверенной транзакции','',{required:true,max:256})+`<p>Проверьте поступление ${escape(record.amount)} ${escape(record.currency)} в сети ${escape(record.network)} на адрес счёта.</p>`,'Подтверждаю поступление'))+panel('Отмена счёта',form('invoice-status',csrf,hidden('id',record.id)+hidden('status','cancelled')+'<p>Отменённый счёт нельзя вернуть в ожидание. При необходимости создайте новый.</p>','Подтверждаю отмену'));
      if(record.status==='paid')html+=panel('Выдача услуги',form('invoice-status',csrf,hidden('id',record.id)+hidden('status','fulfilled')+'<p>Подтвердите, что доступы или услуга переданы клиенту.</p>','Подтверждаю выдачу'));
    }
    const wallets=settings.wallets.filter(w=>w.enabled);html+=panel('Новый счёт',wallets.length?form(section,csrf,input('description','Услуга или назначение платежа','',{required:true})+input('sessionId','Номер диалога',url.searchParams.get('sessionId')||'',{hint:'Необязательно. Можно скопировать из заявки.'})+select('walletId','Криптовалюта и сеть',wallets[0].id,wallets.map(w=>({id:w.id,title:`${w.currency} · ${w.network}${w.label?' · '+w.label:''}`})))+input('amount','Точная сумма','',{required:true,max:50,hint:'Например 25.50. Не используйте запятую.'})+textarea('memo','Примечание для оператора')+'<p class="muted">После создания сумма, сеть и адрес не редактируются. Передайте реквизиты клиенту в диалоге.</p>','Создать счёт'):'<p>Сначала добавьте и включите кошелёк в <a href="/admin/settings">настройках</a>.</p>');
  } else if(section==='chats') {
    const rows=(await db.prepare("SELECT s.*,(SELECT text FROM messages m WHERE m.session_id=s.id ORDER BY m.id DESC LIMIT 1) AS last_text FROM sessions s ORDER BY last_user_at DESC,id DESC LIMIT ? OFFSET ?").bind(pageSize+1,(page-1)*pageSize).all()).results;
    html=panel('Заявки из чата и Telegram',table(['Посетитель','Последнее сообщение','Статус',''],rows.slice(0,pageSize).map(r=>[`${escape(r.name||'Посетитель')}<small>${escape(r.contact)}${r.tg_user_chat_id?' · Telegram':''}</small>`,escape((r.last_text||'').slice(0,120)),badge((r.last_user_at||0)>(r.last_admin_at||0)?'Ждёт ответа':'Ответ отправлен'),`<a class="text-link" href="/admin/chats/${encodeURIComponent(r.id)}">Открыть</a>`]))+pagination(section,page,rows.length>pageSize));
  } else if(section.startsWith('chats/')) {
    const sid=decodeURIComponent(section.slice(6));const chat=await db.prepare('SELECT * FROM sessions WHERE id=?').bind(sid).first();if(!chat)return {title:'Диалог не найден',html:panel('Диалог не найден','<a href="/admin/chats">Вернуться к заявкам</a>')};
    const rows=(await db.prepare('SELECT * FROM (SELECT * FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 300) ORDER BY id').bind(sid).all()).results;
    html=panel(chat.name||'Посетитель',`<p>${escape(chat.contact)}${chat.tg_user_chat_id?' · Telegram':' · Сайт'}</p><p class="muted mono">${escape(sid)}</p><a class="text-link" href="/admin/invoices?sessionId=${encodeURIComponent(sid)}">Создать счёт по заявке</a>`);
    html+=panel('История диалога',`<ol class="messages">${rows.map(r=>`<li class="message ${r.sender==='admin'?'operator':''}"><header><b>${r.sender==='admin'?'Оператор':'Посетитель'}</b><time>${escape(date(r.created_at))}</time></header><p>${escape(r.text)}</p></li>`).join('')}</ol>`);
    html+=panel('Ответить посетителю',form('reply',csrf,hidden('sessionId',sid)+textarea('text','Сообщение','',true),'Отправить ответ'));
  } else {title='Страница не найдена';html=panel(title,'<a href="/admin">Вернуться в админку</a>');}
  return {title,html};
}
function walletForm(wallet:Wallet|undefined,csrf:string) {return form('wallet',csrf,hidden('id',wallet?.id)+input('label','Название для оператора',wallet?.label,{max:100})+`<div class="form-grid">${input('currency','Криптовалюта',wallet?.currency,{required:true,max:12,hint:'BTC, ETH, USDT, XMR, LTC…'})}${input('network','Сеть',wallet?.network,{required:true,max:60,hint:'Bitcoin, Ethereum, TRC-20, ERC-20…'})}</div>`+input('address','Адрес кошелька',wallet?.address,{required:true,max:256})+check('enabled','Разрешить выставление счетов',!!wallet?.enabled));}
