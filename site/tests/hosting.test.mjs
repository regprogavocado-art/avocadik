import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { mapProduct } from '../src/lib/content.ts';
import { formatProductPrice } from '../src/components/catalog.ts';
import { productSpecs, productNumbers, productCountryList, countryFlagPath, flagCountryCodes, domainZone, featuredVps, pricedProducts, categoryPriceGroups } from '../src/lib/hosting.ts';

const db = new DatabaseSync(':memory:');
for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) {
  db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
}
const products = db.prepare('SELECT * FROM cms_products').all().map(mapProduct);
const countries = db.prepare('SELECT * FROM cms_countries').all();
const find = slug => products.find(product => product.slug === slug);
const specs = slug => Object.fromEntries(productSpecs(find(slug)).map(spec => [spec.key, spec.value]));
db.close();

test('published VPS and dedicated specifications retain actual capacities and alternatives', () => {
  assert.deepEqual(specs('fi-vps-1'), { cpu: '1 vCPU', ram: '1 GB RAM', disk: '10 GB SSD', network: '100 Mbps', traffic: 'Уточним' });
  assert.equal(specs('nl-vps-4').network, '10 Gbps');
  assert.equal(specs('se-vps-2').disk, '40 GB NVMe или SSD');
  assert.equal(specs('ch-dedicated-96').cpu, '2 × Intel Xeon X5670');
  assert.equal(specs('ch-dedicated-96').traffic, 'Безлимитный');
  assert.equal(specs('dedicated-i7-7700').cpu, 'Intel Core i7-7700 · 4 ядра / 8 потоков');
  assert.equal(specs('dedicated-i7-7700').disk, '2 × 500 GB NVMe SSD');
  assert.equal(specs('se-dedicated-128').cpu, '2 × Xeon E5-2660 · 16 ядер суммарно');
});

test('unknown networking, disk type and IP allocations are not invented', () => {
  assert.equal(specs('is-vps-4').disk, '80 GB диск');
  assert.equal(specs('is-vps-4').network, 'Уточним');
  assert.equal(specs('is-vps-4').traffic, '4 TB TX/RX');
  assert.ok(!Object.hasOwn(specs('is-vps-4'), 'ip'));
  assert.deepEqual(productSpecs({category:'vps', summary:'Свой тариф', body:'Обсудим ресурсы.'}).map(spec => spec.value), Array(5).fill('Уточним'));
  assert.deepEqual(productSpecs(find('mtproto')), []);
  assert.deepEqual(productSpecs(find('ipv4-private')), [{key:'ip', label:'Тип IP', value:'IPv4'}]);
  assert.deepEqual(productSpecs(find('ipv6')), [{key:'ip', label:'Тип IP', value:'IPv6/32'}]);
  assert.equal(productSpecs({category:'vps',summary:'',body:'IP-адреса: 1 IPv4.'}).find(spec => spec.key === 'ip').value, '1 IPv4');
});

test('numeric filters use only unambiguous documented resources', () => {
  assert.deepEqual(productNumbers(find('nl-vps-4')), {cpuCores:2, ramGb:4, diskGb:40, networkMbps:10000});
  assert.deepEqual(productNumbers(find('dedicated-i7-7700')), {cpuCores:4, ramGb:64, diskGb:1000, networkMbps:1000});
  assert.equal(productNumbers(find('ch-dedicated-96')).cpuCores, null, 'two processors do not imply two cores');
  assert.equal(productNumbers(find('se-dedicated-128')).cpuCores, 16);
  assert.equal(productNumbers(find('se-dedicated-128')).diskGb, null, 'different disk options cannot form a numeric filter');
  assert.equal(productNumbers(find('is-vps-4')).networkMbps, null);
  assert.deepEqual(productNumbers({category:'vps',summary:'Свой тариф',body:''}), {cpuCores:null,ramGb:null,diskGb:null,networkMbps:null});
  assert.equal(productNumbers({category:'vps',summary:'2 vCPU · 4 ГБ ОЗУ · 50 ГБ SSD',body:'Порт: 2.5 Gbps.'}).networkMbps,2500);
});

test('country lists preserve ISO codes without inventing server locations from proxy geography', () => {
  assert.deepEqual(productCountryList(find('nl-vps-4'), countries), [{code:'NL',name:'Нидерланды'}]);
  assert.deepEqual(productCountryList(find('vps-start-5'), countries), []);
  assert.equal(new Set(pricedProducts(products, 'vps').flatMap(product => productCountryList(product,countries).map(country => country.code))).size, 6);
  assert.equal(productCountryList(find('ipv4-private'),countries).length,16);
  assert.deepEqual(productCountryList({countryCodes:['nl','NL','//bad','ZZ']},countries), [{code:'NL',name:'Нидерланды'},{code:'ZZ',name:'ZZ'}]);
  assert.equal(countryFlagPath('nl'),'/assets/flags/nl.svg');
  assert.equal(countryFlagPath('../nl'),undefined);
  assert.equal(countryFlagPath('ZZ'),undefined);
  assert.deepEqual([...flagCountryCodes].sort(),countries.map(country => country.code).sort());
});

test('home offers retain currency and period without ranking different currencies as comparable', () => {
  const featured = featuredVps(products);
  assert.deepEqual(featured.map(product => product.slug),['fi-vps-1','nl-vps-4','se-vps-2','is-vps-1']);
  assert.deepEqual(featured.map(formatProductPrice), ['5,00 USD / мес.','14,00 USD / мес.','10,00 EUR / мес.','8,72 EUR / мес.']);
  assert.equal(pricedProducts(products).length,31);
  assert.equal(pricedProducts(products,'vps').length,12);
  assert.deepEqual(featuredVps(featured.map(product => ({...product, status:'draft'}))),[]);
  assert.deepEqual(featuredVps(featured.map(product => ({...product, price:''}))),[]);
  assert.equal(formatProductPrice(find('ipv4-bulk')),'1,50 USD / 30 дней');
  assert.match(find('ipv4-bulk').priceNote,/за 1 IP.*от 90 IP/);
  assert.match(find('ch-dedicated-96').priceNote,/от 3 месяцев/);
});

test('domain zones come from domain content, not server geography or a product slug', () => {
  assert.equal(domainZone(find('domain-com')),'.com');
  assert.equal(domainZone(find('domain-ru')),'.ru');
  assert.equal(domainZone(find('nl-vps-4')),undefined);
  assert.equal(domainZone({category:'domains',title:'Другой домен',summary:'Регистрация .co.uk · первый год'}),'.co.uk');
  assert.equal(domainZone({category:'domains',title:'Другой домен',summary:'Подбор зоны'}),undefined);
});

test('category minimums keep currencies and periods separate and preserve decimal precision', () => {
  assert.deepEqual(categoryPriceGroups(products,'vps').map(product => [product.priceCurrency,product.price]),[['USD','5.00'],['EUR','8.72']]);
  const base = find('fi-vps-1');
  const examples = [
    {...base,price:'10000000000000000000.02'},
    {...base,price:'10000000000000000000.01'},
    {...base,price:'2.00',pricePeriod:'once'},
    {...base,price:'3.00',priceCurrency:'EUR'},
    {...base,price:'1.00',status:'draft'},
  ];
  assert.deepEqual(categoryPriceGroups(examples,'vps').map(product => [product.priceCurrency,product.pricePeriod,product.price]),[
    ['USD','month','10000000000000000000.01'],['USD','once','2.00'],['EUR','month','3.00'],
  ]);
});
