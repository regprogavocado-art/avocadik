// Общая шина событий — единственный канал связи между модулями.
const target = new EventTarget();

export const bus = {
  emit(type, detail) {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  },
  on(type, fn) {
    const handler = (e) => fn(e.detail);
    target.addEventListener(type, handler);
    return () => target.removeEventListener(type, handler);
  },
};
