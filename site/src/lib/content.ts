/** CMS uses the same D1 binding as the chat Worker. No request data becomes SQL. */
export interface Statement { bind(...values: any[]): Statement; first<T = any>(): Promise<T | null>; all<T = any>(): Promise<{results: T[]}>; run(): Promise<any> }
export interface Database { prepare(query: string): Statement; batch(statements: Statement[]): Promise<any[]> }
export interface Env { DB?: Database; NEWS_MEDIA?: any; ADMIN_PASSWORD_HASH?: string; SESSION_SECRET?: string; ADMIN_API_SECRET?: string; CHAT_SERVICE?: {fetch: typeof fetch}; CHAT_WORKER_URL?: string; [key: string]: any }
export type Publication = 'published' | 'draft';
export interface Page { id: number; slug: string; title: string; summary: string; body: string; status: Publication }
export interface Product { id: number; slug: string; title: string; category: string; summary: string; body: string; price: string; priceCurrency: string; availability: 'available'|'on_request'|'soon'; countryCodes: string[]; image: string; status: Publication }
export interface Country { id: number; code: string; name: string; status: Publication }
export interface Wallet { id: string; currency: string; network: string; address: string; label: string; enabled: boolean }
export interface Settings { telegramUrl: string; email: string; chatApiBase: string; wallets: Wallet[]; paymentTerms: string; refundTerms: string }
export interface News { id: number; slug: string; title: string; body: string; excerpt: string; source: 'manual'|'telegram'; sourceChatId: string; sourceMessageId: number; sourceUrl: string; mediaKey: string; publishedAt: number; createdAt: number; updatedAt: number; hidden: boolean; pinned: boolean; manualOverride: boolean }
export const categories = [
  {id:'domains', title:'Домены', summary:'Поиск, регистрация и массовая закупка доменов.'},
  {id:'vps', title:'VPS', summary:'Виртуальные серверы под задачи вашего проекта.'},
  {id:'dedicated', title:'Выделенные серверы', summary:'Физические серверы с индивидуальной конфигурацией.'},
  {id:'bulletproof', title:'Bulletproof-хостинг', summary:'Новое направление. Подробности — после запуска.'},
  {id:'proxies', title:'Прокси', summary:'Подбор прокси под географию и требования проекта.'}
];
export const seedPages: Page[] = [
  {id:1,slug:'hass',title:'Avocado Hass',summary:'Ваш трафик под защитой',body:'Защита от DDoS-атак и блокировок РКН. Стабильность сервисов, глобальная сеть и аналитика.\n\nОбсудим вашу инфраструктуру и условия подключения в чате.',status:'published'},
  {id:2,slug:'ettinger',title:'Avocado Ettinger',summary:'Офисная оркестрация нового поколения',body:'Массовая закупка доменов и серверов. ИИ-адаптеры. Автоматизация NIC.RU. Регистрация и верификация аккаунтов.\n\nАвтоматизируйте повторяющиеся операции и управляйте инфраструктурой в одной экосистеме.',status:'published'},
  {id:3,slug:'rent',title:'Аренда панели',summary:'Возможности Avocado на нужный срок',body:'Арендуйте панель под задачи вашей команды. Защита, закупки и автоматизация в одной экосистеме.\n\nСрок аренды, набор возможностей и стоимость согласуем в чате. Цена по запросу.',status:'published'},
  {id:4,slug:'home',title:'Инфраструктура, которая работает на вас.',summary:'Защита, автоматизация и масштабирование в одной экосистеме.',body:'Avocado объединяет защиту трафика, анти-DDoS, защиту от блокировок РКН, массовую закупку доменов и серверов, ИИ-адаптеры и автоматизацию NIC.RU.',status:'published'},
  {id:5,slug:'catalog',title:'Инфраструктура под вашу задачу',summary:'Домены, серверы и прокси. Подберём конфигурацию и согласуем условия в чате.',body:'Выберите направление. Страна, наличие и итоговая стоимость подтверждаются оператором перед выставлением счёта.',status:'published'},
  {id:6,slug:'countries',title:'География вашей инфраструктуры',summary:'Нужная локация для вашего проекта.',body:'Уточните страну и требования в чате. Мы проверим доступность и предложим подходящую конфигурацию.',status:'published'},
  {id:7,slug:'payment',title:'Оплата криптовалютой',summary:'Без KYC и верификаций. Согласуйте удобную валюту и сеть в чате.',body:'Обсудите услугу с оператором. Получите счёт с точной суммой, сетью и адресом кошелька. Переведите средства по реквизитам счёта и отправьте идентификатор транзакции в чат. После ручного подтверждения поступления мы выдадим услугу.\n\nПоддержку выбранной криптовалюты и сети подтвердим перед оплатой. Сроки выдачи и условия согласуем до выставления счёта.',status:'published'},
  {id:8,slug:'news',title:'Новости Avocado',summary:'Обновления продуктов и новости инфраструктуры.',body:'Всё важное об экосистеме Avocado.',status:'published'},
  {id:9,slug:'contacts',title:'Обсудим вашу задачу',summary:'Начните с разговора. Поможем выбрать решение.',body:'Напишите в чат на сайте или в Telegram. Расскажите, какая инфраструктура нужна, и мы уточним детали.',status:'published'},
  ...categories.map((c,i)=>({id:10+i,slug:`category-${c.id}`,title:c.title,summary:c.summary,body:c.id==='bulletproof'?'Направление готовится к запуску. Напишите в чат, чтобы обсудить будущие возможности.':'Расскажите о требованиях, географии и нагрузке. Подберём решение, проверим наличие и согласуем стоимость.',status:'published' as Publication}))
];
export const seedProducts: Product[] = categories.map((c,i)=>({id:i+1,slug:c.id,title:c.title,category:c.id,summary:c.summary,body:c.summary,price:'',priceCurrency:'USD',availability:c.id==='bulletproof'?'soon':'on_request',countryCodes:[],image:'',status:'published'}));
export const defaultSettings: Settings = {telegramUrl:'https://t.me/avogurubot',email:'',chatApiBase:'https://avocado-chat.avocado-chat-worker.workers.dev',wallets:[],paymentTerms:'',refundTerms:''};
export function mapProduct(r:any): Product { let codes:string[]=[]; try {codes=JSON.parse(r.country_codes || '[]')} catch {} return {id:r.id,slug:r.slug,title:r.title,category:r.category,summary:r.summary,body:r.body,price:r.price,priceCurrency:r.price_currency,availability:r.availability,countryCodes:codes,image:r.image,status:r.status}; }
export function mapNews(r:any): News {return {id:r.id,slug:r.slug,title:r.title,body:r.body,excerpt:r.excerpt,source:r.source,sourceChatId:r.source_chat_id,sourceMessageId:r.source_message_id,sourceUrl:r.source_url,mediaKey:r.media_key,publishedAt:r.published_at,createdAt:r.created_at,updatedAt:r.updated_at,hidden:!!r.hidden,pinned:!!r.pinned,manualOverride:!!r.manual_override};}
export async function getSettings(env:Env):Promise<Settings> {
  if (!env.DB) return structuredClone(defaultSettings);
  const rows=await env.DB.prepare('SELECT key,value FROM cms_settings').all<{key:string,value:string}>();
  const settings=structuredClone(defaultSettings);
  for(const row of rows.results) {
    if(row.key==='wallets') {try {settings.wallets=JSON.parse(row.value)}catch{settings.wallets=[]}}
    else if(row.key in settings) (settings as any)[row.key]=row.value;
  }
  return settings;
}
export async function getSiteData(env:Env={}) {
  if(!env.DB) return {pages:structuredClone(seedPages),products:structuredClone(seedProducts),countries:[] as Country[],settings:structuredClone(defaultSettings)};
  const [pages,products,countries,settings]=await Promise.all([
    env.DB.prepare("SELECT * FROM cms_pages WHERE status='published' ORDER BY id").all<Page>(),
    env.DB.prepare("SELECT * FROM cms_products WHERE status='published' ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM cms_countries WHERE status='published' ORDER BY name").all<Country>(),getSettings(env)
  ]);
  return {pages:pages.results,products:products.results.map(mapProduct),countries:countries.results,settings};
}
export async function listNews(env:Env={},page=1,pageSize=9):Promise<{items:News[],total:number}> {
  if(!env.DB) return {items:[],total:0};
  page=Math.max(1,Math.floor(Number(page)||1));pageSize=Math.min(50,Math.max(1,Math.floor(Number(pageSize)||9)));
  const now=Date.now();
  const [rows,count]=await Promise.all([env.DB.prepare('SELECT * FROM news WHERE hidden=0 AND published_at<=? ORDER BY pinned DESC,published_at DESC,id DESC LIMIT ? OFFSET ?').bind(now,pageSize,(page-1)*pageSize).all(),env.DB.prepare('SELECT COUNT(*) AS n FROM news WHERE hidden=0 AND published_at<=?').bind(now).first<{n:number}>()]);
  return {items:rows.results.map(mapNews),total:count?.n||0};
}
export async function getNews(env:Env={},slug:string):Promise<News|null> { if(!env.DB) return null; const row=await env.DB.prepare('SELECT * FROM news WHERE slug=? AND hidden=0 AND published_at<=?').bind(slug,Date.now()).first();return row?mapNews(row):null; }
