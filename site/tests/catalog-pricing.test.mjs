import test from 'node:test';
import assert from 'node:assert/strict';
import {formatProductPrice} from '../src/components/catalog.ts';
import {mapProduct,publicProduct} from '../src/lib/content.ts';

test('catalogue prices preserve decimal precision, currencies and billing period',()=>{
  assert.equal(formatProductPrice({price:'1.77',priceCurrency:'USD',pricePeriod:'30_days'}),'1,77 USD / 30 дней');
  assert.equal(formatProductPrice({price:'4.90',priceCurrency:'EUR',pricePeriod:'month'}),'4,90 EUR / мес.');
  assert.equal(formatProductPrice({price:'13.00',priceCurrency:'USD',pricePeriod:'year'}),'13,00 USD / год');
  assert.equal(formatProductPrice({price:'10000000000000000000.000000000000000001',priceCurrency:'USD',pricePeriod:'once'}),'10000000000000000000,000000000000000001 USD / разово');
  assert.equal(formatProductPrice({price:'',priceCurrency:'USD',pricePeriod:'year'}),'По запросу');
});

test('public products exclude purchasing sources while admin records retain them',()=>{
  const legacy=mapProduct({id:1,slug:'old',price:'10',price_currency:'USD',country_codes:'[]'});
  assert.equal(legacy.pricePeriod,undefined);assert.equal(formatProductPrice(legacy),'10 USD');
  const internal=mapProduct({id:2,slug:'ipv4-private',price:'1.77',price_currency:'USD',country_codes:'[]',source_name:'Private procurement',source_url:'https://example.com/prices',source_checked_at:'2026-09-12'});
  assert.equal(internal.sourceName,'Private procurement');
  const visible=publicProduct(internal);
  for(const key of ['sourceName','sourceUrl','sourceCheckedAt']) assert.equal(Object.hasOwn(visible,key),false);
  assert.equal(visible.price,'1.77');
  assert.equal(internal.sourceName,'Private procurement','the admin record is not mutated');
  assert.equal(mapProduct({source_url:'javascript:alert(1)'}).sourceUrl,'');
});
