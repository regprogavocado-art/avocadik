import {categories,seedPages,seedProducts,type Env} from './content.ts';

/** Public route inventory only. Never serialize CMS records or procurement data. */
export interface PublicManifest {generatedAt:string;paths:string[]}
interface PublishedPage {slug:string;status?:string}
interface PublishedProduct {slug:string;category:string;status?:string}
interface PublishedNews {slug:string;hidden?:boolean|number;published_at?:number}
const categoryIds=new Set(categories.map(category=>category.id));
const reservedPages=new Set(['admin','api','media','index','assets','css','js','fonts','404','robots','sitemap']);
const safeSlug=(value:unknown):value is string=>typeof value==='string'&&value.length<=80&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export function buildPublicManifest(pages:PublishedPage[],products:PublishedProduct[],news:PublishedNews[],now=Date.now()):PublicManifest {
  const paths=new Set<string>();
  for(const page of pages){
    if(page.status&&page.status!=='published')continue;
    if(!safeSlug(page.slug)||reservedPages.has(page.slug))continue;
    if(page.slug==='home'){paths.add('/');continue;}
    if(page.slug.startsWith('category-')){
      const category=page.slug.slice('category-'.length);
      if(categoryIds.has(category))paths.add(`/catalog/${category}`);
      continue;
    }
    paths.add(`/${page.slug}`);
  }
  for(const product of products){
    if(product.status&&product.status!=='published')continue;
    if(safeSlug(product.slug)&&categoryIds.has(product.category))paths.add(`/catalog/${product.category}/${product.slug}`);
  }
  const publishedNews=new Set<string>();
  for(const item of news){
    if(item.hidden||!safeSlug(item.slug)||typeof item.published_at!=='number'||!Number.isFinite(item.published_at)||item.published_at>now)continue;
    publishedNews.add(item.slug);
    paths.add(`/news/${item.slug}`);
  }
  // The SSR listing uses nine items per page. Never invent pagination for a hidden listing.
  if(paths.has('/news'))for(let page=2;page<=Math.ceil(publishedNews.size/9);page++)paths.add(`/news?page=${page}`);
  return {generatedAt:new Date(now).toISOString(),paths:[...paths].sort()};
}

export async function getPublicManifest(env:Env={},now=Date.now()):Promise<PublicManifest> {
  if(!env.DB)return buildPublicManifest(seedPages,seedProducts,[],now);
  const [pages,products,news]=await Promise.all([
    env.DB.prepare("SELECT slug FROM cms_pages WHERE status='published' ORDER BY slug").all<PublishedPage>(),
    env.DB.prepare("SELECT slug,category FROM cms_products WHERE status='published' ORDER BY category,slug").all<PublishedProduct>(),
    env.DB.prepare('SELECT slug,published_at FROM news WHERE hidden=0 AND published_at<=? ORDER BY slug').bind(now).all<PublishedNews>()
  ]);
  return buildPublicManifest(pages.results,products.results,news.results,now);
}

export async function publicManifestResponse(env:Env={},now=Date.now()):Promise<Response> {
  const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff'};
  try {return Response.json(await getPublicManifest(env,now),{headers});}
  catch {return Response.json({error:'Public content is temporarily unavailable.'},{status:503,headers});}
}
