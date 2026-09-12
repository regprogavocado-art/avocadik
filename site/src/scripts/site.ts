declare global {
  interface Window { AvocadoChat?: { open: (options: {text: string; opener?: HTMLElement; appendDraft?: boolean}) => boolean }; }
}
const menuToggle = document.querySelector<HTMLButtonElement>('#menu-toggle');
const mobileNav = document.querySelector<HTMLElement>('#mobile-nav');
const softwareNav = document.querySelector<HTMLDetailsElement>('.nav-software');
function setMenu(open: boolean) {
  if (!menuToggle || !mobileNav) return;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  mobileNav.hidden = !open;
  document.body.classList.toggle('menu-open', open);
}
menuToggle?.addEventListener('click', () => setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuToggle?.getAttribute('aria-expanded') === 'true') { setMenu(false); menuToggle.focus(); }
  if (event.key === 'Escape' && softwareNav?.open) { softwareNav.open = false; softwareNav.querySelector('summary')?.focus(); }
});
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (softwareNav?.open && !target?.closest('.nav-software')) softwareNav.open = false;
  const domainLink = target?.closest<HTMLAnchorElement>('[data-focus-domain]');
  if (domainLink) {
    const section = document.getElementById(domainLink.hash.slice(1));
    const input = section?.querySelector<HTMLInputElement>('input');
    if (input) { event.preventDefault(); section?.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center'}); input.focus({preventScroll: true}); }
  }
  const cta = target?.closest<HTMLElement>('[data-chat]');
  if (cta) {
    setMenu(false);
    if (window.AvocadoChat) { event.preventDefault(); window.AvocadoChat.open({text: cta.dataset.chat || '', opener: cta}); }
  } else if (target?.closest('#mobile-nav a')) setMenu(false);
  else if (!target?.closest('.site-header')) setMenu(false);
});
window.matchMedia('(min-width: 1081px)').addEventListener('change', (event) => { if (event.matches) setMenu(false); });
export {};
