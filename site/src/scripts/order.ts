import { domainMessage, matchDomainOffer, normalizeDomain, orderDomainZone, orderMessage, parseOrderProduct, type DomainOffer, type OrderProduct } from '../lib/order';
import { countryFlagPath } from '../lib/hosting';

const dialog = document.querySelector<HTMLDialogElement>('#avocado-order');
if (dialog) {
  const form = dialog.querySelector<HTMLFormElement>('[data-order-form]')!;
  const title = dialog.querySelector<HTMLElement>('#order-title')!;
  const summary = dialog.querySelector<HTMLElement>('[data-order-summary]')!;
  const country = (dialog.querySelector('#order-country') as HTMLSelectElement | null)!;
  const os = (dialog.querySelector('#order-os') as HTMLSelectElement | null)!;
  const comment = dialog.querySelector<HTMLTextAreaElement>('#order-comment')!;
  const domainInput = dialog.querySelector<HTMLInputElement>('#order-domain-input')!;
  const error = dialog.querySelector<HTMLElement>('#order-error')!;
  const existingChat = dialog.querySelector<HTMLButtonElement>('[data-order-existing-chat]')!;
  let current: OrderProduct | null = null;
  let domain = '';
  let offer: DomainOffer | undefined;
  let opener: HTMLElement | null = null;
  const savedChoices = new Map<string, { country: string; os: string; comment: string; domainInput: string }>();
  const choiceKey = () => domain || current?.slug || '';
  const text = (selector: string, value: string) => { dialog.querySelector<HTMLElement>(selector)!.textContent = value; };
  const hidden = (selector: string, value: boolean) => { dialog.querySelector<HTMLElement>(selector)!.hidden = value; };
  const resetError = () => { error.hidden = true; error.textContent = ''; existingChat.hidden = true; domainInput.removeAttribute('aria-invalid'); };
  const showError = (message: string, canOpenChat = false) => { error.textContent = message; error.hidden = false; existingChat.hidden = !canOpenChat; error.scrollIntoView({ block: 'nearest' }); };
  function updateFlag() {
    const image = dialog!.querySelector<HTMLImageElement>('[data-order-flag]')!;
    const flag = countryFlagPath(country.value);
    image.hidden = !flag;
    if (flag) image.src = flag;
  }
  function show(product: OrderProduct | null, source: HTMLElement, requestedDomain = '', domainOffer?: DomainOffer) {
    current = product; domain = requestedDomain; offer = domainOffer; opener = source;
    const needsDomain = product?.category === 'domains' && !domain;
    const directZone = needsDomain ? orderDomainZone(product!) : '';
    if (directZone && product) offer = { zone: directZone, product };
    form.reset(); resetError();
    title.textContent = domain || needsDomain ? 'Заявка на домен' : product?.availability === 'soon' ? 'Узнать о запуске' : 'Заказать услугу';
    summary.textContent = product ? `${product.title}${product.summary ? ` · ${product.summary}` : ''}` : 'Проверим имя и подберём условия регистрации.';
    hidden('[data-order-domain-row]', !domain);
    hidden('[data-order-domain-entry-row]', !needsDomain);
    domainInput.disabled = !needsDomain;
    domainInput.placeholder = directZone ? `your-project.${directZone}` : 'your-project.com';
    text('[data-order-domain]', domain);
    hidden('[data-order-country-row]', Boolean(domain) || product?.category === 'domains');
    hidden('[data-order-os-row]', !product || !['vps', 'dedicated'].includes(product.category));
    os.disabled = !product || !['vps', 'dedicated'].includes(product.category);
    country.replaceChildren(...(product?.countries || []).map(item => new Option(item.name, item.code)));
    const saved = savedChoices.get(choiceKey());
    if (saved) {
      if (product?.countries.some(item => item.code === saved.country)) country.value = saved.country;
      os.value = saved.os; comment.value = saved.comment;
      domainInput.value = saved.domainInput;
    }
    const filteredCountry = source.closest('[data-tariff-grid]')?.querySelector<HTMLElement>('[data-filter-country][aria-pressed="true"]')?.dataset.filterCountry;
    if (filteredCountry && product?.countries.some(item => item.code === filteredCountry)) country.value = filteredCountry;
    country.hidden = !product || product.countries.length <= 1;
    country.disabled = country.hidden;
    hidden('[data-order-country-value]', !country.hidden);
    text('[data-order-country-value]', product?.countries.length === 1 ? product.countries[0].name : 'Уточнить при заказе');
    text('[data-order-country-label]', country.hidden ? 'Локация' : 'Страна размещения');
    updateFlag();
    text('[data-order-price]', product?.priceLabel || 'По запросу');
    text('[data-order-price-note]', product?.priceNote || (product?.availability === 'soon' ? 'Стоимость появится после запуска.' : 'Итоговую сумму согласуем перед оплатой.'));
    text('[data-order-footnote]', product?.availability === 'soon' ? 'Расскажем о планах запуска и доступных вариантах в чате.' : 'Подтвердим наличие и подготовим счёт. Оплата криптовалютой после согласования.');
    comment.placeholder = domain || needsDomain ? 'Регистрация, перенос или другие пожелания' : 'Срок аренды, перенос проекта или другие пожелания';
    dialog!.showModal(); document.body.classList.add('order-open');
    // A domain confirmation has no required editable fields; avoid summoning a phone keyboard for its optional comment.
    (needsDomain ? domainInput : country.hidden ? os.disabled ? dialog!.querySelector<HTMLButtonElement>('[data-order-close]')! : os : country).focus();
  }
  function close(restoreFocus = true) {
    savedChoices.set(choiceKey(), { country: country.value, os: os.value, comment: comment.value, domainInput: domainInput.value });
    dialog!.close(); document.body.classList.remove('order-open');
    if (restoreFocus && opener?.isConnected) opener.focus();
  }
  dialog.querySelector('[data-order-close]')?.addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(element => element.getClientRects().length > 0 && !element.closest('[hidden]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  country.addEventListener('change', updateFlag);
  form.addEventListener('input', resetError);
  form.addEventListener('submit', event => {
    event.preventDefault(); resetError();
    if (!form.reportValidity()) return;
    let message: string;
    try {
      if (comment.value.trim().length > 400) throw new Error('Сократите комментарий до 400 символов.');
      const requestedDomain = domain || (!domainInput.disabled ? normalizeDomain(domainInput.value, offer?.zone || '') : '');
      if (!domainInput.disabled && offer && !requestedDomain.endsWith(`.${offer.zone}`)) throw new Error(`Этот тариф для зоны .${offer.zone}. Измените имя или выберите тариф другой зоны.`);
      message = requestedDomain ? domainMessage(requestedDomain, offer) : current ? orderMessage(current, { country: country.value, os: os.value, comment: comment.value }) : '';
      if (requestedDomain && comment.value.trim()) message += `\nКомментарий: ${comment.value.trim()}`;
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : 'Проверьте выбранные параметры.');
      if (!domainInput.disabled) { domainInput.setAttribute('aria-invalid', 'true'); domainInput.focus(); }
      return;
    }
    if (!message || !window.AvocadoChat) { showError('Чат ещё загружается. Повторите через несколько секунд.'); return; }
    // The modal remains open if the existing visitor draft would exceed the chat limit.
    if (!window.AvocadoChat.open({ text: message, opener: opener || undefined, appendDraft: true })) {
      showError('В чате уже есть длинный черновик. Сначала завершите его, затем вернитесь к заказу. Выбранные параметры сохранены.', true); return;
    }
    close(false);
  });
  existingChat.addEventListener('click', () => { close(false); window.AvocadoChat?.open({ text: '', opener: opener || undefined }); });
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>('[data-order]');
    if (button) {
      const product = parseOrderProduct(button.dataset.order || '');
      if (product) { event.preventDefault(); show(product, button); }
    }
    const zoneButton = target?.closest<HTMLButtonElement>('[data-domain-zone]');
    if (zoneButton) {
      const section = zoneButton.closest<HTMLElement>('.domain-search');
      const select = section?.querySelector('select[name="zone"]') as HTMLSelectElement | null;
      if (select) select.value = zoneButton.dataset.domainZone || select.value;
      section?.querySelector<HTMLInputElement>('input[name="domain"]')?.focus();
    }
  });
  document.querySelectorAll<HTMLFormElement>('[data-domain-form]').forEach(domainForm => {
    domainForm.addEventListener('submit', event => {
      event.preventDefault();
      const input = domainForm.querySelector<HTMLInputElement>('input[name="domain"]')!;
      const zone = (domainForm.querySelector('select[name="zone"]') as HTMLSelectElement | null)!;
      const fieldError = domainForm.querySelector<HTMLElement>('[data-domain-error]')!;
      fieldError.hidden = true; input.removeAttribute('aria-invalid');
      try {
        const name = normalizeDomain(input.value, zone.value);
        const json = domainForm.closest('.domain-search')?.querySelector('[data-domain-offers]')?.textContent || '[]';
        const offers: DomainOffer[] = JSON.parse(json).flatMap((item: any) => {
          const product = parseOrderProduct(JSON.stringify(item.product));
          return product && typeof item.zone === 'string' ? [{ zone: item.zone, product }] : [];
        });
        const selected = matchDomainOffer(name, offers);
        show(selected?.product || null, domainForm.querySelector<HTMLButtonElement>('button[type="submit"]')!, name, selected);
      } catch (reason) {
        fieldError.textContent = reason instanceof Error ? reason.message : 'Проверьте доменное имя.';
        fieldError.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus();
      }
    });
    domainForm.querySelector('input')?.addEventListener('input', () => {
      domainForm.querySelector<HTMLElement>('[data-domain-error]')!.hidden = true;
      domainForm.querySelector('input')!.removeAttribute('aria-invalid');
    });
  });
}
