import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogFilters, catalogFilterHash, matchesCatalogFilters } from '../src/scripts/catalog-filters.ts';

test('static catalog filter state roundtrips in the hash without query routes', () => {
  const filters = parseCatalogFilters('#country=fi&ram=4&currency=eur');
  assert.deepEqual(filters,{country:'FI',ram:4,currency:'EUR'});
  assert.equal(catalogFilterHash(filters),'#country=FI&ram=4&currency=EUR');
  assert.equal(catalogFilterHash({country:'',ram:null,currency:''}),'');
  assert.deepEqual(parseCatalogFilters('#tariffs'),{country:'',ram:null,currency:''});
});

test('country and currency filters match exact records and unknown RAM never passes a capacity filter', () => {
  const us = {countries:['US'],ramGb:4,currency:'USD'};
  const swiss = {countries:['CH'],ramGb:4,currency:'EUR'};
  assert.equal(matchesCatalogFilters(us,{country:'US',ram:4,currency:'USD'}),true);
  assert.equal(matchesCatalogFilters(swiss,{country:'',ram:4,currency:'USD'}),false);
  assert.equal(matchesCatalogFilters(us,{country:'FI',ram:null,currency:''}),false);
  assert.equal(matchesCatalogFilters({...us,ramGb:null},{country:'',ram:1,currency:''}),false);
  assert.equal(matchesCatalogFilters(us,{country:'',ram:8,currency:''}),false);
  assert.equal(matchesCatalogFilters({countries:[],ramGb:null,currency:'USD'},{country:'',ram:null,currency:''}),true);
});

test('invalid or unbounded hash values do not become executable content or numeric filters', () => {
  assert.deepEqual(parseCatalogFilters('#country=../FI&ram=Infinity&currency=<img>'),{country:'',ram:null,currency:''});
  assert.equal(parseCatalogFilters('#ram=-5').ram,null);
  assert.equal(parseCatalogFilters('#ram=99999999999').ram,null);
});
