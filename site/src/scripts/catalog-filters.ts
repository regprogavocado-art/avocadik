export interface CatalogFilters { country: string; ram: number | null; currency: string; }
export interface FilterableTariff { countries: readonly string[]; ramGb: number | null; currency: string; }

export function parseCatalogFilters(hash: string): CatalogFilters {
  const values = new URLSearchParams(hash.replace(/^#/, ''));
  const country = (values.get('country') || '').toUpperCase();
  const currency = (values.get('currency') || '').toUpperCase();
  const rawRam = values.get('ram') || '';
  const ram = /^\d+(?:\.\d+)?$/.test(rawRam) ? Number(rawRam) : null;
  return {
    country: /^[A-Z]{2}$/.test(country) ? country : '',
    currency: /^[A-Z0-9]{2,12}$/.test(currency) ? currency : '',
    ram: ram !== null && Number.isFinite(ram) && ram > 0 && ram <= 1048576 ? ram : null,
  };
}

export function catalogFilterHash(filters: CatalogFilters): string {
  const values = new URLSearchParams();
  if (filters.country) values.set('country', filters.country);
  if (filters.ram !== null) values.set('ram', String(filters.ram));
  if (filters.currency) values.set('currency', filters.currency);
  return values.size ? `#${values}` : '';
}

export function matchesCatalogFilters(tariff: FilterableTariff, filters: CatalogFilters): boolean {
  return (!filters.country || tariff.countries.includes(filters.country))
    && (filters.ram === null || (tariff.ramGb !== null && tariff.ramGb >= filters.ram))
    && (!filters.currency || tariff.currency === filters.currency);
}

export function initCatalogFilters(): void {
  for (const container of document.querySelectorAll<HTMLElement>('[data-tariff-grid]')) {
    if (container.dataset.filtersReady === 'true') continue;
    container.dataset.filtersReady = 'true';
    const cards = [...container.querySelectorAll<HTMLElement>('[data-tariff]')];
    const countryButtons = [...container.querySelectorAll<HTMLButtonElement>('[data-filter-country]')];
    const ramControl = container.querySelector('[data-filter-ram]') as HTMLSelectElement | null;
    const currencyControl = container.querySelector('[data-filter-currency]') as HTMLSelectElement | null;
    const reset = container.querySelector<HTMLButtonElement>('[data-filter-reset]');
    const empty = container.querySelector<HTMLElement>('[data-filter-empty]');
    const count = container.querySelector<HTMLElement>('[data-filter-count]');
    const knownCountries = new Set(countryButtons.map(button => button.dataset.filterCountry));
    const knownCurrencies = new Set([...currencyControl?.options || []].map(option => option.value));
    const knownRam = new Set([...ramControl?.options || []].map(option => option.value));
    let current: CatalogFilters = { country: '', ram: null, currency: '' };

    function apply(filters: CatalogFilters, updateHash: boolean): void {
      current = {
        country: knownCountries.has(filters.country) ? filters.country : '',
        ram: filters.ram !== null && knownRam.has(String(filters.ram)) ? filters.ram : null,
        currency: knownCurrencies.has(filters.currency) ? filters.currency : '',
      };
      const active = Boolean(current.country || current.currency || current.ram !== null);
      let visible = 0;
      for (const card of cards) {
        const rawRam = card.dataset.ram;
        const tariff: FilterableTariff = {
          countries: (card.dataset.countries || '').split(',').filter(Boolean),
          ramGb: rawRam && Number.isFinite(Number(rawRam)) ? Number(rawRam) : null,
          currency: card.dataset.currency || '',
        };
        const show = matchesCatalogFilters(tariff, current) && (active || card.dataset.initial !== 'false');
        card.hidden = !show;
        if (show) visible++;
      }
      for (const button of countryButtons) button.setAttribute('aria-pressed', String((button.dataset.filterCountry || '') === current.country));
      if (ramControl) ramControl.value = current.ram === null ? '' : String(current.ram);
      if (currencyControl) currencyControl.value = current.currency;
      if (reset) reset.disabled = !active;
      if (empty) empty.hidden = visible > 0;
      if (count) count.textContent = !active && visible < cards.length ? `Показано ${visible} из ${cards.length} тарифов` : `Тарифов: ${visible}`;
      if (updateHash) history.replaceState(null, '', `${location.pathname}${location.search}${catalogFilterHash(current)}`);
    }

    for (const button of countryButtons) button.addEventListener('click', () => apply({ ...current, country: button.dataset.filterCountry || '' }, true));
    ramControl?.addEventListener('change', () => apply({ ...current, ram: ramControl.value ? Number(ramControl.value) : null }, true));
    currencyControl?.addEventListener('change', () => apply({ ...current, currency: currencyControl.value }, true));
    reset?.addEventListener('click', () => apply({ country: '', ram: null, currency: '' }, true));
    addEventListener('hashchange', () => apply(parseCatalogFilters(location.hash), false));
    apply(parseCatalogFilters(location.hash), false);
  }
}
