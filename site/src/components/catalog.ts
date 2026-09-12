export const categories = [
  { slug: 'domains', title: 'Домены', icon: 'globe', short: 'Адрес вашего проекта', description: 'Подбор и регистрация доменов. Одна задача или массовая закупка — обсудим нужные зоны и объём.', details: ['Выбор доменной зоны', 'Регистрация и продление', 'Массовые операции'], image: '/assets/img/category-domains.webp' },
  { slug: 'vps', title: 'VPS', icon: 'cpu', short: 'Ресурсы для роста', description: 'Виртуальные серверы под приложения, сервисы и рабочие процессы. Конфигурация и локация под вашу нагрузку.', details: ['CPU, память и диски под нагрузку', 'Выбор страны размещения', 'Условия масштабирования'], image: '/assets/img/category-vps.webp' },
  { slug: 'dedicated', title: 'Выделенные серверы', icon: 'server', short: 'Мощность под ваш контроль', description: 'Отдельный физический сервер для задач, которым нужны собственные ресурсы. Подберём конфигурацию и размещение.', details: ['Индивидуальная конфигурация', 'Согласование локации', 'Помощь с запуском'], image: '/assets/img/category-dedicated.webp' },
  { slug: 'bulletproof', title: 'Bulletproof-хостинг', icon: 'shield', short: 'Новое направление', description: 'Готовим новое направление хостинга. Условия размещения и доступные конфигурации появятся после запуска.', details: [], image: '/assets/img/category-bulletproof.webp', soon: true },
  { slug: 'proxies', title: 'Прокси', icon: 'route', short: 'Нужный маршрут', description: 'Подбор прокси под требования проекта. Обсудим географию, протоколы, количество адресов и срок использования.', details: ['География подключения', 'Подбор протокола', 'Объём и срок использования'], image: '/assets/img/category-proxies.webp' },
] as const;
export const availabilityLabels: Record<string, string> = { available: 'В наличии', on_request: 'По запросу', soon: 'Скоро' };
export function safeImage(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; }
}
export function categorySrcSet(value: string | undefined): string | undefined {
  return value && /^\/assets\/img\/category-(domains|vps|dedicated|bulletproof|proxies)\.webp$/.test(value)
    ? `${value.replace('.webp', '-640.webp')} 640w, ${value} 1600w`
    : undefined;
}
