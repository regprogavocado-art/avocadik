/** CMS uses the same D1 binding as the chat Worker. No request data becomes SQL. */
export interface Statement { bind(...values: any[]): Statement; first<T = any>(): Promise<T | null>; all<T = any>(): Promise<{results: T[]}>; run(): Promise<any> }
export interface Database { prepare(query: string): Statement; batch(statements: Statement[]): Promise<any[]> }
export interface Env { DB?: Database; NEWS_MEDIA?: any; ADMIN_PASSWORD_HASH?: string; SESSION_SECRET?: string; ADMIN_API_SECRET?: string; CHAT_SERVICE?: {fetch: typeof fetch}; CHAT_WORKER_URL?: string; [key: string]: any }
export type Publication = 'published' | 'draft';
export type PricePeriod = 'month' | 'year' | '30_days' | 'once';
export const pricePeriods: PricePeriod[] = ['month','year','30_days','once'];
export interface Page { id: number; slug: string; title: string; summary: string; body: string; status: Publication }
export interface Product { id: number; slug: string; title: string; category: string; summary: string; body: string; price: string; priceCurrency: string; pricePeriod?: PricePeriod; priceNote?: string; sourceName?: string; sourceUrl?: string; sourceCheckedAt?: string; availability: 'available'|'on_request'|'soon'; countryCodes: string[]; image: string; status: Publication }
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
  {
    "id": 1,
    "slug": "hass",
    "title": "Avocado Hass",
    "summary": "Собственное ПО для защиты вашей инфраструктуры",
    "body": "Avocado Hass — наш программный продукт для защиты трафика, противодействия DDoS и поддержания доступности сервисов. Развиваем управление защитой и аналитику в едином интерфейсе.\n\nОбсудим вашу инфраструктуру, задачи и условия подключения в чате.",
    "status": "published"
  },
  {
    "id": 2,
    "slug": "ettinger",
    "title": "Avocado Ettinger",
    "summary": "Собственное ПО для автоматизации операций",
    "body": "Avocado Ettinger — наш программный продукт для оркестрации инфраструктуры и автоматизации повторяющихся операций. Массовые задачи, ИИ-адаптеры и инструменты управления для вашей команды.\n\nДомены и серверы доступны как дополнительные услуги Avocado. Подберём конфигурацию и согласуем условия в чате.",
    "status": "published"
  },
  {
    "id": 3,
    "slug": "rent",
    "title": "Аренда панели",
    "summary": "Возможности Avocado на нужный срок",
    "body": "Арендуйте панель под задачи вашей команды. Защита, закупки и автоматизация в одной экосистеме.\n\nСрок аренды, набор возможностей и стоимость согласуем в чате. Цена по запросу.",
    "status": "published"
  },
  {
    "id": 4,
    "slug": "home",
    "title": "Анонимный хостинг. Инфраструктура под вашим контролем.",
    "summary": "VPS, выделенные серверы, домены и прокси от Avocado. Без KYC и проверки документов. Оплата криптовалютой. Подберём ресурсы и локацию под ваш проект.",
    "body": "Выберите конфигурацию, отправьте заявку и оплатите счёт криптовалютой. Наличие и срок выдачи подтверждаем до оплаты.",
    "status": "published"
  },
  {
    "id": 5,
    "slug": "catalog",
    "title": "Хостинг и инфраструктура",
    "summary": "VPS, выделенные серверы, домены и прокси с оплатой криптовалютой.",
    "body": "Домены, серверы и прокси Avocado для ваших проектов. В каталоге указаны ориентировочные цены для предварительного расчёта. Наличие, географию, конфигурацию и итоговую сумму подтвердим в чате перед счётом.\n\nСтоимость регистрации и продления доменного имени согласуется до оплаты.",
    "status": "published"
  },
  {
    "id": 6,
    "slug": "countries",
    "title": "География инфраструктуры",
    "summary": "Выберите страну и посмотрите тарифы VPS, серверов и прокси в этой локации.",
    "body": "Подберём страну размещения и ресурсы под задачи вашего проекта. Наличие нужной услуги, конкретную локацию и конфигурацию подтвердим в чате.\n\nДоступность выбранного типа прокси в каждой стране уточняется отдельно.",
    "status": "published"
  },
  {
    "id": 7,
    "slug": "payment",
    "title": "Оплата криптовалютой",
    "summary": "Криптооплата без KYC со стороны Avocado.",
    "body": "Согласуйте с оператором услугу, сумму, криптовалюту и сеть. Для оплаты Avocado не запрашивает документы для верификации личности; передавайте только данные, необходимые для выполнения заявки.\n\nПолучите счёт с адресом кошелька и точной суммой. Переведите средства в указанной сети и сообщите идентификатор транзакции в чате. После ручного подтверждения оплаты согласуем выдачу услуги или следующий этап разработки.\n\nУсловия конкретной услуги и сроки уточняем до выставления счёта.",
    "status": "published"
  },
  {
    "id": 8,
    "slug": "news",
    "title": "Новости Avocado",
    "summary": "Новости хостинга, новые локации и обновления продуктов Avocado.",
    "body": "Всё важное об экосистеме Avocado.",
    "status": "published"
  },
  {
    "id": 9,
    "slug": "contacts",
    "title": "Обсудим вашу задачу",
    "summary": "Начните с разговора. Поможем выбрать решение.",
    "body": "Напишите в чат на сайте или в Telegram. Расскажите, какая инфраструктура нужна, и мы уточним детали.",
    "status": "published"
  },
  {
    "id": 10,
    "slug": "category-domains",
    "title": "Домены",
    "summary": "Поиск, регистрация и массовая закупка доменов.",
    "body": "Домены Avocado для ваших проектов. Указана ориентировочная стоимость первого года. Доступность имени, точную цену регистрации и продления подтвердим в чате перед счётом.",
    "status": "published"
  },
  {
    "id": 11,
    "slug": "category-vps",
    "title": "VPS-серверы",
    "summary": "Выберите страну, процессор, память и диск. Закажите VPS с оплатой криптовалютой.",
    "body": "Сравните ресурсы и выберите конфигурацию для сайта, приложения или рабочего окружения. В каждой карточке — характеристики, локация и стоимость за месяц. Наличие, итоговую сумму и срок выдачи подтвердим перед счётом.",
    "status": "published"
  },
  {
    "id": 12,
    "slug": "category-dedicated",
    "title": "Выделенные серверы",
    "summary": "Физические серверы с индивидуальной конфигурацией.",
    "body": "Выделенные серверы Avocado под задачи вашего проекта. Указаны ориентировочные цены. Проверьте минимальный срок аренды в карточке; наличие и итоговую сумму подтвердим в чате.",
    "status": "published"
  },
  {
    "id": 13,
    "slug": "category-bulletproof",
    "title": "Bulletproof-хостинг",
    "summary": "Новое направление. Подробности — после запуска.",
    "body": "Направление готовится к запуску. Напишите в чат, чтобы обсудить будущие возможности.",
    "status": "published"
  },
  {
    "id": 14,
    "slug": "category-proxies",
    "title": "Прокси",
    "summary": "Подбор прокси под географию и требования проекта.",
    "body": "Прокси Avocado для ваших задач. Ориентировочная цена указана за один IP на 30 дней с учётом диапазона количества. Тип прокси, страну, наличие и итоговую стоимость согласуем в чате.",
    "status": "published"
  },
  {
    "id": 15,
    "slug": "software",
    "title": "Разработка ПО под вашу задачу",
    "summary": "От идеи и архитектуры до работающего продукта.",
    "body": "Разрабатываем веб-приложения, внутренние инструменты и автоматизацию для бизнеса. Изучим задачу, предложим техническое решение и согласуем этапы, сроки и стоимость.\n\nСобственные продукты Avocado Hass и Ettinger развиваем вместе с решениями на заказ. Инфраструктуру для проекта — домены, серверы и прокси — можно подобрать дополнительно.\n\nРасскажите о задаче в чате. Обсуждение конфиденциально; для начала достаточно описания проекта.",
    "status": "published"
  }
];
export const seedProducts: Product[] = categories.map((c,i)=>({id:i+1,slug:c.id,title:c.title,category:c.id,summary:c.summary,body:c.summary,price:'',priceCurrency:'USD',availability:c.id==='bulletproof'?'soon':'on_request',countryCodes:[],image:'',status:'published'}));
export const defaultSettings: Settings = {telegramUrl:'https://t.me/avogurubot',email:'',chatApiBase:'https://avocado-chat.avocado-chat-worker.workers.dev',wallets:[],paymentTerms:'',refundTerms:''};
export function safeSourceUrl(value: string | undefined | null): string | undefined {
  if(!value || !/^https:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value))return undefined;
  try {const url=new URL(value);return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password?url.href:undefined;}catch{return undefined;}
}
export function validSourceDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const timestamp=Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===value;
}
export function mapProduct(r:any): Product { let codes:string[]=[]; try {codes=JSON.parse(r.country_codes || '[]')} catch {} return {id:r.id,slug:r.slug,title:r.title,category:r.category,summary:r.summary,body:r.body,price:r.price,priceCurrency:r.price_currency,pricePeriod:pricePeriods.includes(r.price_period)?r.price_period:undefined,priceNote:r.price_note||'',sourceName:r.source_name||'',sourceUrl:safeSourceUrl(r.source_url)||'',sourceCheckedAt:validSourceDate(r.source_checked_at||'')?r.source_checked_at:'',availability:r.availability,countryCodes:codes,image:r.image,status:r.status}; }
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
export function publicProduct(product:Product):Product {
  const {sourceName,sourceUrl,sourceCheckedAt,...visible}=product;
  return visible;
}
export async function getSiteData(env:Env={}) {
  if(!env.DB) return {pages:structuredClone(seedPages),products:structuredClone(seedProducts),countries:[] as Country[],settings:structuredClone(defaultSettings)};
  const [pages,products,countries,settings]=await Promise.all([
    env.DB.prepare("SELECT * FROM cms_pages WHERE status='published' ORDER BY id").all<Page>(),
    env.DB.prepare("SELECT * FROM cms_products WHERE status='published' ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM cms_countries WHERE status='published' ORDER BY name").all<Country>(),getSettings(env)
  ]);
  return {pages:pages.results,products:products.results.map(row=>publicProduct(mapProduct(row))),countries:countries.results,settings};
}
export async function listNews(env:Env={},page=1,pageSize=9):Promise<{items:News[],total:number}> {
  if(!env.DB) return {items:[],total:0};
  page=Math.max(1,Math.floor(Number(page)||1));pageSize=Math.min(50,Math.max(1,Math.floor(Number(pageSize)||9)));
  const now=Date.now();
  const [rows,count]=await Promise.all([env.DB.prepare('SELECT * FROM news WHERE hidden=0 AND published_at<=? ORDER BY pinned DESC,published_at DESC,id DESC LIMIT ? OFFSET ?').bind(now,pageSize,(page-1)*pageSize).all(),env.DB.prepare('SELECT COUNT(*) AS n FROM news WHERE hidden=0 AND published_at<=?').bind(now).first<{n:number}>()]);
  return {items:rows.results.map(mapNews),total:count?.n||0};
}
export async function getNews(env:Env={},slug:string):Promise<News|null> { if(!env.DB) return null; const row=await env.DB.prepare('SELECT * FROM news WHERE slug=? AND hidden=0 AND published_at<=?').bind(slug,Date.now()).first();return row?mapNews(row):null; }
