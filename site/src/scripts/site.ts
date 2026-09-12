declare global {
  interface Window { AvocadoChat?: { open: (options: {text: string; opener: HTMLElement}) => void }; }
}
const menuToggle = document.querySelector<HTMLButtonElement>('#menu-toggle');
const mobileNav = document.querySelector<HTMLElement>('#mobile-nav');
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
});
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const cta = target?.closest<HTMLElement>('[data-chat]');
  if (cta) {
    setMenu(false);
    if (window.AvocadoChat) { event.preventDefault(); window.AvocadoChat.open({text: cta.dataset.chat || '', opener: cta}); }
  } else if (target?.closest('#mobile-nav a')) setMenu(false);
  else if (!target?.closest('.site-header')) setMenu(false);
});
window.matchMedia('(min-width: 1081px)').addEventListener('change', (event) => { if (event.matches) setMenu(false); });
export {};
