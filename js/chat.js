/* Avocado — чат-виджет. Посетитель пишет здесь, оператор отвечает в Telegram (см. worker/). */
(function () {
  'use strict';
  const cfg = window.AVOCADO_CONFIG || {};
  const C = Object.assign({
    title: 'Avocado',
    subtitle: 'Обычно отвечаем в течение часа',
    welcome: 'Здравствуйте! Опишите задачу — ответим прямо здесь. Оставьте Telegram или почту: если закроете сайт, напишем туда.',
    offline: 'Здравствуйте! Сейчас принимаем заявки в Telegram — напишите нам, ответим там.',
    pollOpenMs: 3000, pollClosedMs: 15000, idleStopMin: 30
  }, cfg.chat || {});
  const API = String(cfg.chatApiBase || '').replace(/\/+$/, '');
  const LS = 'avocado.chat.';
  const LAUNCHER_LABEL = 'Написать нам';
  const T = {
    tgLink: 'Открыть Telegram →',
    hint: 'Оставьте контакт — ответим, даже если вы закроете страницу.',
    noConnection: 'Нет соединения — пробуем переподключиться',
    historyFail: 'Нет связи с чатом — пробуем переподключиться. Пока можно написать нам в Telegram.',
    undelivered: 'Сообщение сохранено, но оператор ещё не получил уведомление. Если ответа долго нет — напишите нам в Telegram.',
    limit: 'Слишком много сообщений подряд. Подождите минуту и нажмите «повторить».',
    sendFail: 'Сообщение не отправилось. Нажмите «повторить» или напишите нам в Telegram.',
    srFail: 'Сообщение не отправлено. Нажмите «повторить».',
    retry: 'Не отправлено · повторить',
    newMsg: 'Новое сообщение: ',
    contactMsg: 'Мой контакт: '
  };

  /* ── хранилище ─────────────────────────────────────────────────── */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch { /* хранилище недоступно */ } }
  };
  const genId = () => {
    if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  };

  const state = {
    sid: store.get('sid', null),
    name: store.get('name', ''),
    contact: store.get('contact', ''),
    messages: [],            // {id, from, text, ts, status}
    seen: new Set(),
    lastId: 0,               // растёт только по ответам GET
    open: false,
    unread: 0,
    lastActivity: Date.now(),
    pollTimer: null,
    loaded: false,
    tmp: 0,
    lastPrefill: '',         // последний подставленный CTA-текст: заменяем его, но не черновик посетителя
    inflight: 0,             // POST в полёте — опрос не запускаем
    opener: null             // элемент, с которого открыли чат — вернём ему фокус
  };
  if (!state.sid) { state.sid = genId(); store.set('sid', state.sid); }

  /* ── разметка ──────────────────────────────────────────────────── */
  const root = document.getElementById('chat-root') || document.body.appendChild(document.createElement('div'));
  root.innerHTML = `
    <button class="ac-launcher" type="button" aria-label="${LAUNCHER_LABEL}" aria-haspopup="dialog" aria-controls="acPanel" aria-expanded="false">
      <svg class="ac-mark" aria-hidden="true"><use href="#i-avocado"/></svg>
      <span>${LAUNCHER_LABEL}</span>
      <i class="ac-badge" aria-hidden="true"></i>
    </button>
    <section class="ac-panel" id="acPanel" role="dialog" aria-modal="false" aria-label="Чат с Avocado" aria-hidden="true" inert>
      <div class="ac-head">
        <svg class="ac-mark" aria-hidden="true"><use href="#i-avocado"/></svg>
        <div class="ac-head-text"><b></b><small></small></div>
        <button class="ac-close" type="button" aria-label="Свернуть чат"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>
      </div>
      <div class="ac-body" role="log"></div>
      <div class="ac-sr" role="status" aria-live="polite"></div>
      <div class="ac-notice" hidden></div>
      <div class="ac-intro">
        <label>Имя<input type="text" name="name" autocomplete="name" autocapitalize="words" maxlength="80" placeholder="Как к вам обращаться"></label>
        <label>Telegram или почта для ответа<input type="text" name="contact" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="120" placeholder="@username или email"></label>
        <p class="ac-intro-hint" hidden></p>
      </div>
      <form class="ac-form">
        <textarea name="text" rows="1" maxlength="2000" enterkeyhint="send" placeholder="Напишите сообщение…" aria-label="Сообщение"></textarea>
        <button class="ac-send" type="submit" aria-label="Отправить"><svg class="ic" aria-hidden="true"><use href="#i-send"/></svg></button>
      </form>
      <div class="ac-foot">Enter — отправить, Shift+Enter — новая строка</div>
    </section>`;

  const el = {
    launcher: root.querySelector('.ac-launcher'),
    badge: root.querySelector('.ac-badge'),
    panel: root.querySelector('.ac-panel'),
    title: root.querySelector('.ac-head-text b'),
    subtitle: root.querySelector('.ac-head-text small'),
    close: root.querySelector('.ac-close'),
    body: root.querySelector('.ac-body'),
    sr: root.querySelector('.ac-sr'),
    notice: root.querySelector('.ac-notice'),
    intro: root.querySelector('.ac-intro'),
    hint: root.querySelector('.ac-intro-hint'),
    name: root.querySelector('input[name=name]'),
    contact: root.querySelector('input[name=contact]'),
    form: root.querySelector('.ac-form'),
    text: root.querySelector('textarea'),
    send: root.querySelector('.ac-send')
  };
  el.title.textContent = C.title;
  el.subtitle.textContent = C.subtitle;
  el.hint.textContent = T.hint;
  el.name.value = state.name;
  el.contact.value = state.contact;
  const baseTitle = document.title;

  /* ── утилиты ───────────────────────────────────────────────────── */
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const escapeAttr = escapeHtml;
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const linkify = (s) => escapeHtml(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const isPhone = () => window.matchMedia('(max-width: 480px)').matches;
  const pageChrome = () => Array.from(document.body.children).filter((n) => n !== root);
  function tgLink(text) {
    if (!cfg.telegramUrl) return '';
    if (!text) return cfg.telegramUrl;
    return cfg.telegramUrl + (cfg.telegramUrl.includes('?') ? '&' : '?') + 'text=' + encodeURIComponent(text);
  }
  function tgAnchor(text) {
    const href = tgLink(text);
    return href ? ` <a href="${escapeAttr(href)}" target="_blank" rel="noopener">${escapeHtml(T.tgLink)}</a>` : '';
  }

  /* ── режим без бэкенда: заявки принимаем в Telegram ────────────── */
  const offline = !API;
  function renderOffline(text) {
    const html = tgAnchor(text).trim();
    el.notice.hidden = !html;
    el.notice.innerHTML = html;
  }
  if (offline) {
    el.panel.classList.add('is-offline');
    el.send.disabled = true;
    el.text.disabled = true;
    renderOffline('');
  }

  /* ── объявления и уведомления ──────────────────────────────────── */
  function announce(text) { el.sr.textContent = ''; setTimeout(() => { el.sr.textContent = text; }, 50); }
  // sticky-уведомления (лимит, не отправилось, оператор не уведомлён) не гасятся фоновым опросом
  function showNotice(text, withTg, sticky, tgText) {
    el.notice.hidden = false;
    el.notice.dataset.sticky = sticky ? '1' : '';
    el.notice.innerHTML = escapeHtml(text) + (withTg ? tgAnchor(tgText || '') : '');
    announce(text);
  }
  function hideNotice(force) {
    if (offline) return;
    if (force || !el.notice.dataset.sticky) { el.notice.hidden = true; el.notice.dataset.sticky = ''; }
  }
  function setOnline(on) {
    el.panel.classList.toggle('is-disconnected', !on);
    el.subtitle.textContent = on ? C.subtitle : T.noConnection;
  }

  /* ── рендер ────────────────────────────────────────────────────── */
  function renderAll() {
    el.body.innerHTML = '';
    addBubble({ from: 'sys', text: offline ? C.offline : C.welcome, ts: 0 });
    let lastDay = '';
    state.messages.forEach((m) => {
      const d = fmtDay(m.ts);
      if (d !== lastDay) { lastDay = d; const s = document.createElement('div'); s.className = 'ac-day'; s.textContent = d; el.body.appendChild(s); }
      addBubble(m);
    });
    scrollDown();
    markSeen();
  }
  function addBubble(m) {
    const div = document.createElement('div');
    div.className = `ac-msg ${m.from}` + (m.status ? ` ${m.status}` : '');
    div.dataset.id = m.id || '';
    div.innerHTML = linkify(m.text) + (m.ts ? `<time>${fmtTime(m.ts)}</time>` : '');
    if (m.status === 'failed') {
      const r = document.createElement('button'); r.type = 'button'; r.className = 'ac-retry'; r.textContent = T.retry;
      r.addEventListener('click', () => deliver(m));
      div.appendChild(r);
    }
    el.body.appendChild(div);
    return div;
  }
  function scrollDown() { el.body.scrollTop = el.body.scrollHeight; }
  function setUnread(n) {
    state.unread = n;
    el.badge.textContent = n > 9 ? '9+' : String(n);
    el.badge.classList.toggle('is-on', n > 0);
    el.launcher.setAttribute('aria-label', n > 0 ? `${LAUNCHER_LABEL} — новых сообщений: ${n > 9 ? '9+' : n}` : LAUNCHER_LABEL);
    document.title = n > 0 ? `(${n}) ${baseTitle}` : baseTitle;
  }
  // запоминаем последний ответ оператора, который посетитель реально видел
  function markSeen() {
    if (!state.open || document.hidden) return;
    const last = [...state.messages].reverse().find((m) => m.from === 'admin' && typeof m.id === 'number');
    if (last) store.set('seenAdminId', last.id);
  }
  // поля имени/контакта показываем, пока контакт не оставлен; после первого сообщения — компактно
  function updateIntro() {
    if (offline) return;
    const hasContact = Boolean(state.contact);
    const started = state.messages.some((m) => m.from === 'user' && !m.status);
    el.intro.classList.toggle('hidden', hasContact);
    el.intro.classList.toggle('compact', !hasContact && started);
    el.hint.hidden = !(!hasContact && started);
  }

  /* ── открыть / закрыть ─────────────────────────────────────────── */
  function open(opts) {
    opts = opts || {};
    if (offline) renderOffline(opts.text || '');
    state.opener = opts.opener || (document.activeElement && document.activeElement !== document.body ? document.activeElement : null);
    state.open = true;
    document.body.classList.add('ac-open');
    el.panel.setAttribute('aria-hidden', 'false');
    el.panel.inert = false;
    if (isPhone()) { el.panel.setAttribute('aria-modal', 'true'); pageChrome().forEach((n) => { n.inert = true; }); }
    el.launcher.setAttribute('aria-expanded', 'true');
    setUnread(0);
    markSeen();
    touch();
    if (!state.loaded && !offline) loadHistory();
    if (opts.text && !offline) {
      const cur = el.text.value.trim();
      // подставляем текст CTA только в пустое поле или поверх нетронутой прошлой подстановки
      if (!cur || cur === state.lastPrefill) { el.text.value = opts.text; state.lastPrefill = opts.text.trim(); autosize(); }
    }
    const target = offline ? (el.notice.querySelector('a') || el.close) : el.text;
    setTimeout(() => target.focus(), 60);
    if (!offline) el.text.focus();
    schedulePoll();
  }
  function close() {
    state.open = false;
    document.body.classList.remove('ac-open');
    el.panel.setAttribute('aria-hidden', 'true');
    el.panel.inert = true;
    el.panel.setAttribute('aria-modal', 'false');
    pageChrome().forEach((n) => { n.inert = false; });
    el.launcher.setAttribute('aria-expanded', 'false');
    const back = state.opener && state.opener.isConnected ? state.opener : el.launcher;
    state.opener = null;
    back.focus();
    if (document.activeElement !== back) el.launcher.focus();
    schedulePoll();
  }
  el.launcher.addEventListener('click', () => open());
  el.close.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open) close(); });

  /* ── сеть ──────────────────────────────────────────────────────── */
  async function api(path, init) {
    init = Object.assign({}, init);
    if (init.body) init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers); // GET — simple request, без preflight
    const res = await fetch(API + path, init);
    if (!res.ok) { const err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
    return res.json();
  }
  async function loadHistory() {
    try {
      const data = await api(`/api/chat/${state.sid}/messages?after=0`);
      state.loaded = true;
      setOnline(true);
      ingest(data.messages || [], false);
      if (data.session) {
        if (data.session.name && !state.name) { state.name = data.session.name; el.name.value = state.name; }
        if (data.session.contact && !state.contact) { state.contact = data.session.contact; el.contact.value = state.contact; }
      }
      updateIntro();
      renderAll();
    } catch (e) {
      setOnline(false);
      if (store.get('hasDialog', false)) showNotice(T.historyFail, true);
    }
  }
  function ingest(list, notify) {
    let added = 0, adminNew = 0, changed = false;
    const fresh = [];
    list.forEach((m) => {
      if (m.id > state.lastId) state.lastId = m.id;   // всегда, даже для уже известных id
      if (state.seen.has(m.id)) return;
      state.seen.add(m.id);
      // эхо своего сообщения, POST которого ещё не ответил
      const own = m.from === 'user' && state.messages.find((x) => x.status === 'pending' && x.text === m.text);
      if (own) { own.id = m.id; own.ts = m.ts; own.status = ''; changed = true; return; }
      state.messages.push({ id: m.id, from: m.from, text: m.text, ts: m.ts });
      added++; changed = true;
      if (m.from === 'admin') { adminNew++; fresh.push(m.text); }
    });
    if (changed) store.set('hasDialog', true);
    state.messages.sort((a, b) => (a.ts - b.ts) || ((a.id || 0) - (b.id || 0)));
    if (changed && notify) {
      renderAll();
      updateIntro();
      if (fresh.length) announce(T.newMsg + fresh.join('. '));
      if (adminNew) {
        hideNotice(true); // оператор ответил — предупреждения больше не актуальны
        if (!state.open || document.hidden) setUnread(state.unread + adminNew);
      }
    }
    return added;
  }
  async function poll() {
    if (offline || state.inflight) return;
    try {
      const data = await api(`/api/chat/${state.sid}/messages?after=${state.lastId}`);
      setOnline(true);
      hideNotice();
      ingest(data.messages || [], true);
    } catch (e) { setOnline(false); }
  }
  function schedulePoll() {
    clearTimeout(state.pollTimer); state.pollTimer = null;
    if (offline) return;
    if (!state.open && !state.messages.length) return;
    if ((Date.now() - state.lastActivity) / 60000 > C.idleStopMin) return;
    const ms = (state.open && !document.hidden) ? C.pollOpenMs : C.pollClosedMs; // в фоне — редкий опрос
    state.pollTimer = setTimeout(async () => { await poll(); schedulePoll(); }, ms);
  }
  function touch() { state.lastActivity = Date.now(); }
  document.addEventListener('visibilitychange', () => {
    touch();
    if (!document.hidden && state.open) { setUnread(0); markSeen(); } // вернулись во вкладку с открытым чатом — прочитано
    poll().then(schedulePoll);
  });
  window.addEventListener('focus', () => { touch(); schedulePoll(); });
  // активность на странице продлевает опрос вместо молчаливой остановки через idleStopMin
  ['pointerdown', 'keydown', 'scroll'].forEach((ev) => document.addEventListener(ev, () => {
    const stopped = !state.pollTimer; touch(); if (stopped) schedulePoll();
  }, { passive: true }));

  /* ── отправка ──────────────────────────────────────────────────── */
  async function send(text) {
    text = String(text || '').trim();
    if (!text || offline) return;
    touch();
    const m = { id: 'tmp' + (++state.tmp), from: 'user', text, ts: Date.now(), status: 'pending' };
    state.messages.push(m);
    store.set('hasDialog', true);
    renderAll();
    el.text.value = ''; state.lastPrefill = ''; autosize();
    updateIntro();
    await deliver(m);
  }
  async function deliver(m) {
    m.status = 'pending';
    state.inflight++;
    // поля читаем в момент доставки — контакт, введённый после неудачи, уйдёт с повтором
    state.name = el.name.value.trim().slice(0, 80);
    state.contact = el.contact.value.trim().slice(0, 120);
    store.set('name', state.name); store.set('contact', state.contact);
    const node = el.body.querySelector(`[data-id="${m.id}"]`); if (node) { node.classList.remove('failed'); node.classList.add('pending'); }
    try {
      const data = await api(`/api/chat/${state.sid}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text: m.text, name: state.name, contact: state.contact, page: location.pathname + location.hash })
      });
      m.id = data.id; m.ts = data.ts || m.ts; m.status = '';
      state.seen.add(data.id);
      setOnline(true);
      if (data.delivered === false) showNotice(T.undelivered, true, true, m.text);
      else hideNotice(true);
      renderAll();
      updateIntro();
      if (!state.contact && el.contact.value.trim()) el.contact.dispatchEvent(new Event('change'));
    } catch (e) {
      m.status = 'failed';
      renderAll();
      if (e.status === 429) showNotice(T.limit, false, true);
      else {
        if (!e.status) setOnline(false);
        showNotice(T.sendFail, true, true, m.text);
        announce(T.srFail);
      }
    } finally {
      state.inflight--;
      poll().then(schedulePoll);
    }
  }
  // контакт, введённый уже после начала диалога, отправляем оператору сразу, сохраняя черновик
  el.contact.addEventListener('change', () => {
    const v = el.contact.value.trim().slice(0, 120);
    if (!v || v === state.contact) return;
    if (!state.messages.some((m) => m.from === 'user' && !m.status)) return;
    const draft = el.text.value;
    send(T.contactMsg + v);
    el.text.value = draft; autosize();
  });

  el.form.addEventListener('submit', (e) => { e.preventDefault(); send(el.text.value); });
  el.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(el.text.value); }
  });
  function autosize() {
    el.text.style.height = 'auto';
    const chrome = el.text.offsetHeight - el.text.clientHeight; // рамки при box-sizing: border-box
    el.text.style.height = Math.min(el.text.scrollHeight + chrome, 140) + 'px';
  }
  el.text.addEventListener('input', autosize);
  autosize();

  /* ── запуск ────────────────────────────────────────────────────── */
  renderAll();
  updateIntro();
  if (!offline && store.get('hasDialog', false)) {
    // диалог уже был — подгрузим тихо, чтобы показать бейдж с непрочитанными ответами
    loadHistory().then(() => {
      const seen = store.get('seenAdminId', 0);
      const unread = state.messages.filter((m) => m.from === 'admin' && m.id > seen).length;
      if (unread && !state.open) setUnread(unread);
      schedulePoll();
    });
  }

  window.AvocadoChat = { open, close, send, sid: state.sid };
})();
