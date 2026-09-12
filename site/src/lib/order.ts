import type { Product, Country } from './content.ts';
import { formatProductPrice } from '../components/catalog.ts';

export interface OrderProduct {
  slug: string;
  title: string;
  category: string;
  summary: string;
  priceLabel: string;
  priceNote: string;
  availability: 'available' | 'on_request' | 'soon';
  countries: { code: string; name: string }[];
}
export interface DomainOffer { zone: string; product: OrderProduct }
export const osChoices = ['Подобрать ОС', 'Ubuntu', 'Debian', 'Другая'] as const;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const categoryNames: Record<string, string> = { domains: 'Домены', vps: 'VPS', dedicated: 'Выделенные серверы', proxies: 'Прокси', bulletproof: 'Bulletproof-хостинг' };

/** Explicit public projection: procurement fields and arbitrary CMS properties never reach the button. */
export function orderProduct(product: Product, countries: Country[] = []): OrderProduct {
  return {
    slug: product.slug, title: product.title, category: product.category, summary: product.summary,
    priceLabel: formatProductPrice(product), priceNote: product.priceNote || '', availability: product.availability,
    countries: [...new Set(product.countryCodes)].filter(code => /^[A-Z]{2}$/.test(code)).map(code => ({ code, name: countries.find(country => country.code === code)?.name || code })),
  };
}

export function parseOrderProduct(value: string): OrderProduct | null {
  try {
    if (value.length > 12000) return null;
    const item = JSON.parse(value);
    const bounded = (key: string, max: number, required = false) => typeof item[key] === 'string' && item[key].length <= max && (!required || item[key].trim().length > 0);
    if (!item || typeof item !== 'object' || !bounded('slug', 80, true) || !slugPattern.test(item.slug) || !bounded('title', 150, true) || !Object.hasOwn(categoryNames, item.category)) return null;
    if (!bounded('summary', 500) || !bounded('priceLabel', 200, true) || !bounded('priceNote', 200) || !['available', 'on_request', 'soon'].includes(item.availability)) return null;
    if (!Array.isArray(item.countries) || item.countries.length > 250 || item.countries.some((country: any) => !country || !/^[A-Z]{2}$/.test(country.code) || typeof country.name !== 'string' || !country.name || country.name.length > 100)) return null;
    // Keep the parser's result as narrow as the server projection, even for modified HTML.
    return { slug: item.slug, title: item.title, category: item.category, summary: item.summary, priceLabel: item.priceLabel, priceNote: item.priceNote, availability: item.availability, countries: item.countries.map(({ code, name }: { code: string; name: string }) => ({ code, name })) };
  } catch { return null; }
}

/** Syntax validation only. Neither DNS nor registration availability is inferred. */
export function normalizeDomain(value: string, zone = ''): string {
  let input = value.trim().normalize('NFC').toLowerCase().replace(/[\u3002\uff0e\uff61]/g, '.');
  if (!input) throw new Error('Введите доменное имя.');
  if (input.length > 253 || !/^[\p{L}\p{N}\p{M}.-]+$/u.test(input)) throw new Error('Введите только доменное имя, без https://, пути и пробелов.');
  if (!input.includes('.')) {
    const suffix = zone.replace(/^\./, '').toLowerCase();
    if (!suffix || !/^[a-z0-9.-]+$/.test(suffix)) throw new Error('Выберите зону или укажите полный домен, например example.com.');
    input += `.${suffix}`;
  }
  let hostname: string;
  try { hostname = new URL(`https://${input}/`).hostname; } catch { throw new Error('Проверьте доменное имя: в нём есть недопустимые символы.'); }
  const labels = hostname.split('.');
  if (hostname.length > 253 || labels.length < 2 || labels.some(label => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) throw new Error('В каждой части домена должно быть от 1 до 63 букв, цифр или дефисов; дефис не может стоять на краю.');
  const tld = labels.at(-1)!;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(tld)) throw new Error('Укажите доменную зону, например .com или .ru.');
  return hostname;
}

export function domainOffers(products: Product[]): DomainOffer[] {
  const seen = new Set<string>();
  return products.filter(product => product.category === 'domains' && product.status === 'published' && product.availability !== 'soon').flatMap(product => {
    const zone = orderDomainZone(product);
    if (!zone) return [];
    try {
      if (seen.has(zone)) return [];
      seen.add(zone);
      return [{ zone, product: orderProduct(product) }];
    } catch { return []; }
  });
}

export function orderDomainZone(product: Pick<OrderProduct, 'category' | 'title'>): string {
  if (product.category !== 'domains') return '';
  const match = product.title.match(/(?:^|\s)\.([a-zа-яё0-9-]+(?:\.[a-zа-яё0-9-]+)*)(?=$|\s|[,;:()])/i);
  if (!match) return '';
  try { return normalizeDomain(`example.${match[1]}`).slice('example.'.length); } catch { return ''; }
}

export function matchDomainOffer(domain: string, offers: DomainOffer[]): DomainOffer | undefined {
  return [...offers].sort((a, b) => b.zone.length - a.zone.length).find(offer => domain.endsWith(`.${offer.zone}`));
}

export function orderMessage(product: OrderProduct, choices: { country?: string; os?: string; comment?: string; domain?: string } = {}): string {
  const lines = [product.availability === 'soon' ? 'Здравствуйте! Хочу узнать о запуске услуги Avocado.' : 'Здравствуйте! Хочу заказать услугу Avocado.', `Услуга: ${categoryNames[product.category]}.`, `Тариф: ${product.title}.`, `Цена на сайте: ${product.priceLabel}.`];
  if (product.priceNote) lines.push(`Условия цены: ${product.priceNote}.`);
  if (choices.domain) lines.push(`Домен для проверки: ${normalizeDomain(choices.domain)}.`, 'Проверьте доступность имени и стоимость регистрации и продления.');
  if (product.category !== 'domains') {
    const country = product.countries.find(item => item.code === choices.country);
    if (product.countries.length && !country) throw new Error('Выберите страну из списка тарифа.');
    lines.push(`Локация: ${country ? country.name : 'уточнить при заказе'}.`);
  }
  if (['vps', 'dedicated'].includes(product.category)) {
    const os = choices.os || osChoices[0];
    if (!osChoices.includes(os as typeof osChoices[number])) throw new Error('Выберите пожелание к ОС из списка.');
    lines.push(`Пожелание к ОС: ${os}.`);
  }
  const comment = (choices.comment || '').trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (comment.length > 400) throw new Error('Сократите комментарий до 400 символов.');
  if (comment) lines.push(`Комментарий: ${comment}`);
  if (product.availability !== 'soon') lines.push('Подтвердите наличие и итоговую сумму. Оплата криптовалютой после согласования счёта.');
  lines.push(`Страница: https://avocado.rest/catalog/${product.category}/${product.slug}/`);
  return lines.join('\n');
}

export function domainMessage(domain: string, offer?: DomainOffer): string {
  const name = normalizeDomain(domain);
  if (offer) return orderMessage(offer.product, { domain: name });
  return `Здравствуйте! Хочу зарегистрировать домен ${name}.\nПроверьте доступность имени и стоимость регистрации и продления.\nОплата криптовалютой после согласования счёта.`;
}
