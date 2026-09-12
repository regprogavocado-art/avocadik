import type { Country, Product } from './content.ts';

/** Presentation helpers read only published product fields, never procurement metadata. */
export interface ProductSpec { key: 'cpu' | 'ram' | 'disk' | 'network' | 'traffic' | 'ip'; label: string; value: string; }
export interface ProductNumbers { cpuCores: number | null; ramGb: number | null; diskGb: number | null; networkMbps: number | null; }
export interface ProductCountry { code: string; name: string; }
const unknown = 'Уточним';
const serverCategories = new Set(['vps', 'dedicated']);
export const flagCountryCodes = ['AE', 'CA', 'CH', 'DE', 'ES', 'FI', 'FR', 'GB', 'IS', 'KZ', 'NL', 'PL', 'RU', 'SE', 'SG', 'UA', 'US'] as const;
const flags = new Set<string>(flagCountryCodes);

export function countryFlagPath(code: string): string | undefined {
  const normalized = code.trim().toUpperCase();
  return flags.has(normalized) ? `/assets/flags/${normalized.toLowerCase()}.svg` : undefined;
}

function labeledValue(body: string, labels: string): string | undefined {
  // A full stop before whitespace ends a sentence; a decimal point does not.
  const match = body.match(new RegExp(`(?:^|[\\n. ]+)(?:${labels})\\s*:\\s*(.+?)(?=\\.(?:\\s|$)|\\n|$)`, 'i'));
  return match?.[1].trim() || undefined;
}

export function productSpecs(product: Pick<Product, 'category' | 'summary' | 'body'>): ProductSpec[] {
  const summary = product.summary || '';
  const body = product.body || '';
  const segments = summary.split(/\s*·\s*/).filter(Boolean);
  const rows: ProductSpec[] = [];
  if (serverCategories.has(product.category)) {
    const ramIndex = segments.findIndex(segment => /\d[\d.,]*\s*(?:[MGT]B|[МГТ]Б)\s*(?:RAM|ОЗУ)(?=\s|$)/i.test(segment));
    const cpuParts = segments.slice(0, ramIndex < 0 ? segments.length : ramIndex)
      .filter(segment => /vCPU|яд(?:ро|ра|ер)|Intel|Xeon|Ryzen|EPYC|Core\s+i\d/i.test(segment));
    const disk = segments.slice(ramIndex + 1).find(segment => /\d[\d.,]*\s*(?:[MGT]B|[МГТ]Б)\s*(?:SSD|NVMe|HDD|SATA|диск)/i.test(segment));
    rows.push(
      { key: 'cpu', label: 'Процессор', value: cpuParts.join(' · ') || unknown },
      { key: 'ram', label: 'Память', value: ramIndex < 0 ? unknown : segments[ramIndex] },
      { key: 'disk', label: 'Диск', value: disk || unknown },
      { key: 'network', label: 'Порт', value: labeledValue(body, 'Порт|Канал|Port') || unknown },
      { key: 'traffic', label: 'Трафик', value: labeledValue(body, 'Трафик|Traffic') || unknown },
    );
  }
  // A mention of a network protocol is not evidence of an included IP allocation.
  const ip = product.category === 'proxies'
    ? summary.match(/\bIPv[46](?:\/\d{1,3})?\b/i)?.[0]
    : labeledValue(body, 'IP-адреса?|IPv4-адреса?|IP addresses?');
  if (ip) rows.push({ key: 'ip', label: product.category === 'proxies' ? 'Тип IP' : 'IP-адреса', value: ip });
  return rows;
}

function capacityGb(value: string): number | null {
  if (/(?:^|\s)(?:или|or)(?:\s|$)|\//i.test(value)) return null;
  const capacity = value.match(/^(?:(\d+)\s*[×x]\s*)?(\d+(?:[.,]\d+)?)\s*(MB|GB|TB|МБ|ГБ|ТБ)(?=\s|$)/i);
  if (!capacity) return null;
  const multiplier = /^(?:TB|ТБ)$/i.test(capacity[3]) ? 1000 : /^(?:MB|МБ)$/i.test(capacity[3]) ? 0.001 : 1;
  const result = Number(capacity[1] || 1) * Number(capacity[2].replace(',', '.')) * multiplier;
  return Number.isFinite(result) && result > 0 ? result : null;
}

/** Numeric filters stay empty when a spec is absent or describes alternative configurations. */
export function productNumbers(product: Pick<Product, 'category' | 'summary' | 'body'>): ProductNumbers {
  const specs = Object.fromEntries(productSpecs(product).map(spec => [spec.key, spec.value]));
  const coreMatch = (specs.cpu || '').match(/(?:^|\s)(\d+)\s*(?:vCPU|яд(?:ро|ра|ер))(?:\b|\s|$)/i);
  const portMatch = (specs.network || '').match(/^(\d+(?:[.,]\d+)?)\s*(Mbps|Gbps|Мбит\/с|Гбит\/с)$/i);
  return {
    cpuCores: coreMatch ? Number(coreMatch[1]) : null,
    ramGb: capacityGb(specs.ram || ''),
    diskGb: capacityGb(specs.disk || ''),
    networkMbps: portMatch ? Number(portMatch[1].replace(',', '.')) * (/^(?:Gbps|Гбит)/i.test(portMatch[2]) ? 1000 : 1) : null,
  };
}

export function productCountryList(product: Pick<Product, 'countryCodes'>, countries: readonly Country[]): ProductCountry[] {
  const names = new Map(countries.filter(country => country.status === 'published').map(country => [country.code.toUpperCase(), country.name]));
  return [...new Set(product.countryCodes.map(code => code.trim().toUpperCase()).filter(code => /^[A-Z]{2}$/.test(code)))]
    .map(code => ({ code, name: names.get(code) || code }));
}

export function domainZone(product: Pick<Product, 'category' | 'title' | 'summary'>): string | undefined {
  if (product.category !== 'domains') return undefined;
  return `${product.title} ${product.summary}`.match(/(?:^|\s)(\.[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)*)(?=\s|$|[·,;])/i)?.[1].toLowerCase();
}

export function pricedProducts(products: readonly Product[], category?: string): Product[] {
  return products.filter(product => product.status === 'published' && (!category || product.category === category)
    && /^\d+(?:\.\d+)?$/.test(product.price) && /[1-9]/.test(product.price));
}

export const featuredVpsSlugs = ['fi-vps-1', 'nl-vps-4', 'se-vps-2', 'is-vps-1'] as const;
export function featuredVps(products: readonly Product[]): Product[] {
  const priced = pricedProducts(products, 'vps');
  return featuredVpsSlugs.flatMap(slug => {
    const product = priced.find(product => product.slug === slug && product.availability !== 'soon');
    return product ? [product] : [];
  });
}

function compareAmounts(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const a = leftWhole.replace(/^0+(?=\d)/, '');
  const b = rightWhole.replace(/^0+(?=\d)/, '');
  if (a.length !== b.length) return a.length - b.length;
  if (a !== b) return a < b ? -1 : 1;
  const length = Math.max(leftFraction.length, rightFraction.length);
  const af = leftFraction.padEnd(length, '0');
  const bf = rightFraction.padEnd(length, '0');
  return af === bf ? 0 : af < bf ? -1 : 1;
}

/** One indicative minimum per currency AND billing period; no exchange rates or period conversions. */
export function categoryPriceGroups(products: readonly Product[], category: string): Product[] {
  const groups = new Map<string, Product>();
  for (const product of pricedProducts(products, category).filter(product => product.availability !== 'soon')) {
    const key = `${product.priceCurrency}:${product.pricePeriod || ''}`;
    const previous = groups.get(key);
    if (!previous || compareAmounts(product.price, previous.price) < 0) groups.set(key, product);
  }
  return [...groups.values()];
}
