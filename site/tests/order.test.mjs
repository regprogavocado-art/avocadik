import test from 'node:test';
import assert from 'node:assert/strict';
import { orderProduct, parseOrderProduct, normalizeDomain, domainOffers, matchDomainOffer, orderMessage, domainMessage } from '../src/lib/order.ts';

const product = { slug: 'test-vps', title: 'Avocado VPS', category: 'vps', summary: '2 vCPU · 4 GB RAM', price: '14.00', priceCurrency: 'EUR', pricePeriod: 'month', priceNote: 'Ориентировочная цена', availability: 'on_request', countryCodes: ['NL'], status: 'published', sourceName: 'Private vendor', sourceUrl: 'https://private.invalid', sourceCheckedAt: '2026-09-12' };
test('order payload preserves exact advertised pricing and contains only public fields', () => {
  const visible = orderProduct(product, [{ code: 'NL', name: 'Нидерланды' }]);
  assert.equal(visible.priceLabel, '14,00 EUR / мес.');
  assert.equal(visible.countries[0].name, 'Нидерланды');
  assert.doesNotMatch(JSON.stringify(visible), /source|Private|private\.invalid/);
  assert.deepEqual(parseOrderProduct(JSON.stringify({ ...visible, sourceUrl: product.sourceUrl })), visible);
  assert.equal(parseOrderProduct(JSON.stringify({ ...visible, category: '__proto__' })), null);
  assert.equal(parseOrderProduct(JSON.stringify({ ...visible, slug: '../admin' })), null);
});
test('domain input normalizes IDN and optional zone without inventing availability', () => {
  assert.equal(normalizeDomain(' EXAMPLE.Com '), 'example.com');
  assert.equal(normalizeDomain('project', '.net'), 'project.net');
  assert.equal(normalizeDomain('пример.рф'), 'xn--e1afmkfd.xn--p1ai');
  assert.equal(normalizeDomain('example.com', '.net'), 'example.com', 'a full domain is never silently moved to another zone');
  for (const value of ['https://example.com', 'a@example.com', 'example.com/path', '*.example.com', 'example.com:443', 'exa mple.com', '-bad.com', 'bad-.com', 'a..com', 'example.com.', '127.0.0.1', '0x7f000001', 'host.123', `${'x'.repeat(64)}.com`, 'x'.repeat(254)]) assert.throws(() => normalizeDomain(value), value);
});
test('domain offers use published domain prices, support compound zones, and leave unknown zones unpriced', () => {
  const input = [
    { ...product, category: 'domains', title: 'Домен .com', slug: 'domain-com', pricePeriod: 'year' },
    { ...product, category: 'domains', title: 'Домен .co.uk', slug: 'domain-co-uk', pricePeriod: 'year' },
    { ...product, category: 'domains', title: 'Домен .net', status: 'draft' },
    { ...product, category: 'domains', title: 'Домен .рф', slug: 'domain-rf', pricePeriod: 'year' },
    { ...product, category: 'domains', title: 'Домены под задачу' },
  ];
  const offers = domainOffers(input);
  assert.deepEqual(offers.map(item => item.zone), ['com', 'co.uk', 'xn--p1ai']);
  assert.equal(matchDomainOffer('project.co.uk', offers)?.zone, 'co.uk');
  assert.equal(matchDomainOffer('project.xyz', offers), undefined);
  assert.match(domainMessage('project.com', offers[0]), /14,00 EUR \/ год/);
  assert.doesNotMatch(domainMessage('project.xyz'), /свободен|доступен|14,00|EUR/);
  assert.match(domainMessage('project.xyz'), /Проверьте доступность/);
});
test('order request keeps chosen country and OS, rejects invented options and overlong comments', () => {
  const visible = orderProduct(product, [{ code: 'NL', name: 'Нидерланды' }]);
  const message = orderMessage(visible, { country: 'NL', os: 'Debian', comment: 'Нужен перенос проекта.' });
  assert.match(message, /Локация: Нидерланды/);
  assert.match(message, /Пожелание к ОС: Debian/);
  assert.match(message, /Подтвердите наличие и итоговую сумму/);
  assert.ok(message.length < 2000);
  assert.throws(() => orderMessage(visible, { country: 'US' }), /Выберите страну/);
  assert.throws(() => orderMessage(visible, { country: 'NL', os: 'Unlisted' }), /Выберите пожелание/);
  assert.throws(() => orderMessage(visible, { country: 'NL', comment: 'a'.repeat(401) }), /400/);
  assert.match(orderMessage({ ...visible, countries: [] }), /Локация: уточнить при заказе/);
});
