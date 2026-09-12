/* Avocado — поведение лендинга: reveal, шапка, мобильное меню, ссылки из конфига, CTA → чат */
(function () {
  'use strict';
  const cfg = window.AVOCADO_CONFIG || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const safe = (fn) => { try { fn(); } catch (e) { console.error(e); } };

  /* Reveal при скролле — первым, чтобы сбой в другом блоке не оставил контент скрытым.
     Скрытие включается только классом .js на <html> (ставится в <head>), без JS всё видно сразу. */
  safe(() => {
    const revealEls = $$('.reveal');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!('IntersectionObserver' in window) || reduce) {
      revealEls.forEach((el) => el.classList.add('is-in'));
      return;
    }
    revealEls.forEach((el) => {
      const siblings = Array.from(el.parentElement.children).filter((c) => c.classList.contains('reveal'));
      el.style.setProperty('--d', `${Math.min(siblings.indexOf(el), 7) * 60}ms`);
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    revealEls.forEach((el) => io.observe(el));
  });

  /* Шапка: подложка при скролле */
  safe(() => {
    const header = $('#header');
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  });

  /* Мобильное меню */
  const toggle = $('#navToggle');
  const nav = $('#nav');
  const navOpen = () => document.body.classList.contains('nav-open');
  const setNav = (open) => {
    document.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    if (open) { const first = nav.querySelector('a'); if (first) first.focus(); }
  };
  safe(() => {
    toggle.addEventListener('click', () => setNav(!navOpen()));
    $$('a', nav).forEach((a) => a.addEventListener('click', () => setNav(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && navOpen()) { setNav(false); toggle.focus(); } });
    window.addEventListener('resize', () => { if (window.innerWidth > 1024) setNav(false); });
  });

  /* Активный пункт меню по текущей секции */
  safe(() => {
    const links = $$('.nav > a[href^="#"]');
    const setActive = (id) => links.forEach((a) => {
      const on = a.getAttribute('href') === '#' + id;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    if (!('IntersectionObserver' in window)) return;
    const so = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }), { rootMargin: '-40% 0px -55% 0px' });
    links.map((a) => $(a.getAttribute('href'))).filter(Boolean).forEach((s) => so.observe(s));
  });

  /* Ссылки из конфига: data-link="telegramUrl" и т.п. Пустые — скрываем (вместе с пустым блоком иконок) */
  safe(() => {
    $$('[data-link]').forEach((a) => {
      const url = cfg[a.dataset.link];
      if (url) a.href = url; else a.hidden = true;
    });
    $$('.socials').forEach((s) => { s.hidden = !$$('a:not([hidden])', s).length; });
  });

  /* Год в подвале */
  safe(() => { const y = $('#year'); if (y) y.textContent = String(new Date().getFullYear()); });

  /* Все CTA с data-chat открывают виджет с заготовленным текстом */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chat]');
    if (!btn) return;
    e.preventDefault();
    setNav(false);
    if (window.AvocadoChat) window.AvocadoChat.open({ text: btn.dataset.chat || '', opener: btn });
  });
})();
