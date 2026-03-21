const API_BASE = window.KursInfra ? window.KursInfra.resolveApiBase() : 'http://localhost:5075';
const AUTH_KEY = 'worker_auth';
const SEEN_NOTIFY_KEY = 'worker_seen_notifications';
let session = null;
let swReg = null;

const authCard = document.getElementById('auth-card');
const actionCard = document.getElementById('action-card');
const authMsg = document.getElementById('auth-msg');
const saveMsg = document.getElementById('save-msg');
let notificationsTimer = null;
let seenNotificationIds = new Set();
let notificationHub = null;
let selectedNotificationId = null;
let saveInProgress = false;

try {
  const seenRaw = localStorage.getItem(SEEN_NOTIFY_KEY);
  if (seenRaw) {
    const parsed = JSON.parse(seenRaw);
    if (Array.isArray(parsed)) seenNotificationIds = new Set(parsed);
  }
} catch {
  seenNotificationIds = new Set();
}

function setMsg(el, text, type = '') {
  el.textContent = text;
  el.className = 'msg ' + type;
}

function setSession(payload) {
  session = payload;
  localStorage.setItem(AUTH_KEY, JSON.stringify(payload));
  authCard.style.display = 'none';
  actionCard.style.display = 'block';
  setConnectionStatus('Online: connecting realtime...');
  loadActions();
  loadNotifications();
  startNotificationsPolling();
  connectNotificationsRealtime();
}

function clearSession() {
  if (notificationsTimer) {
    clearInterval(notificationsTimer);
    notificationsTimer = null;
  }
  if (notificationHub) {
    notificationHub.stop().catch(() => {});
    notificationHub = null;
  }
  session = null;
  localStorage.removeItem(AUTH_KEY);
  selectedNotificationId = null;
  authCard.style.display = 'block';
  actionCard.style.display = 'none';
}

function startNotificationsPolling() {
  if (notificationsTimer) clearInterval(notificationsTimer);
  notificationsTimer = setInterval(loadNotifications, 30000);
}

function setConnectionStatus(text) {
  const el = document.getElementById('conn-status');
  if (el) el.textContent = 'Status: ' + text;
}

async function connectNotificationsRealtime() {
  if (!window.signalR || !session?.token) return;
  if (notificationHub && notificationHub.state !== 'Disconnected') return;

  notificationHub = new signalR.HubConnectionBuilder()
    .withUrl(API_BASE + '/hubs/notifications', {
      accessTokenFactory: () => session?.token || ''
    })
    .withAutomaticReconnect()
    .build();

  notificationHub.on('notification_created', async item => {
    if (item?.id && !seenNotificationIds.has(item.id)) {
      seenNotificationIds.add(item.id);
      rememberSeenIds();
      await showBrowserNotification(item);
    }
    loadNotifications();
  });

  notificationHub.on('notification_acknowledged', () => {
    loadNotifications();
  });

  try {
    await notificationHub.start();
    setConnectionStatus('Realtime connected');
  } catch {
    // Fallback to polling only.
    setConnectionStatus('Polling fallback');
  }
}

async function registerWorkerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('sw.js');
  } catch {
    swReg = null;
  }
}

async function askNotificationPermissionIfNeeded() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {
      // Ignore permission errors.
    }
  }
}

function rememberSeenIds() {
  try {
    localStorage.setItem(SEEN_NOTIFY_KEY, JSON.stringify(Array.from(seenNotificationIds).slice(-1000)));
  } catch {
    // Ignore storage quota issues.
  }
}

async function showBrowserNotification(item) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const title = item.title || 'Yangi bildirishnoma';
  const options = {
    body: item.message || '',
    tag: `notif-${item.id}`,
    data: { id: item.id, relatedId: item.relatedId || '' }
  };

  if (swReg) {
    await swReg.showNotification(title, options);
    return;
  }

  new Notification(title, options);
}

async function request(path, options = {}) {
  if (window.KursInfra?.apiRequest) {
    return window.KursInfra.apiRequest(API_BASE, path, {
      ...options,
      token: session?.token
    });
  }

  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(API_BASE + path, { ...options, headers });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error(typeof data === 'string' ? data : (data?.title || data?.message || 'Server error'));
  }
  return data;
}

async function login() {
  const userName = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  if (!userName || !password) {
    setMsg(authMsg, 'Username va parol kiriting', 'err');
    return;
  }

  try {
    const payload = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ userName, password })
    });

    if (!['Worker', 'VIP', 'Developer'].includes(payload.role)) {
      setMsg(authMsg, 'Bu role worker app uchun ruxsat etilmagan', 'err');
      return;
    }

    setSession(payload);
    setMsg(authMsg, 'Kirish muvaffaqiyatli', 'ok');
  } catch (e) {
    setMsg(authMsg, 'Login xato: ' + e.message, 'err');
  }
}

async function saveAction() {
  if (saveInProgress) return;

  const actionType = document.getElementById('action-type').value;
  const amount = parseFloat(document.getElementById('amount').value);
  const currency = document.getElementById('currency').value;
  const note = document.getElementById('note').value.trim();

  if (!amount || amount <= 0) {
    setMsg(saveMsg, 'Miqdor > 0 bo\'lishi kerak', 'err');
    return;
  }

  try {
    saveInProgress = true;
    await request('/api/workercashactions', {
      method: 'POST',
      body: JSON.stringify({ actionType, amount, currency, note, actionAt: new Date().toISOString() })
    });
    setMsg(saveMsg, 'Saqlandi', 'ok');
    document.getElementById('amount').value = '';
    document.getElementById('note').value = '';
    loadActions();
  } catch (e) {
    setMsg(saveMsg, 'Saqlash xato: ' + e.message, 'err');
  } finally {
    saveInProgress = false;
  }
}

async function loadActions() {
  const container = document.getElementById('list');
  container.innerHTML = 'Yuklanmoqda...';
  try {
    const rows = await request('/api/workercashactions?take=30');
    if (!rows.length) {
      container.innerHTML = '<div class="item">Yozuvlar yo\'q</div>';
      return;
    }

    container.innerHTML = rows.map(r => {
      const sign = r.actionType === 'give' ? '+' : '-';
      const unit = r.currency === 'won' ? 'WON' : 'USD';
      const when = new Date(r.actionAt).toLocaleString();
      return `<div class="item"><strong>${sign} ${Number(r.amount).toLocaleString()} ${unit}</strong><div class="meta">${r.userName} • ${when}${r.note ? ' • ' + r.note : ''}</div></div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div class="item">Xato: ${e.message}</div>`;
  }
}

async function acknowledgeNotification(id) {
  try {
    await request(`/api/notifications/${id}/ack`, { method: 'POST' });
    loadNotifications();
    setMsg(saveMsg, 'Bildirishnoma tasdiqlandi', 'ok');
  } catch (e) {
    setMsg(saveMsg, 'Tasdiqlash xato: ' + e.message, 'err');
  }
}

function extractAmountCurrency(message) {
  if (!message) return { amount: null, currency: null };
  const m = message.match(/([\d][\d,]*(?:\.\d+)?)\s*(WON|USD)/i);
  if (!m) return { amount: null, currency: null };

  const amount = parseFloat(m[1].replace(/,/g, ''));
  const currency = m[2].toLowerCase() === 'won' ? 'won' : 'usd';
  if (!amount || amount <= 0) return { amount: null, currency: null };
  return { amount, currency };
}

function selectNotification(item) {
  selectedNotificationId = item.id;
  document.getElementById('selected-notify-box').style.display = 'block';
  document.getElementById('selected-notify-text').textContent = item.message || item.title || 'Tanlangan';

  const parsed = extractAmountCurrency(item.message || '');
  if (parsed.amount) {
    document.getElementById('amount').value = parsed.amount;
  }
  if (parsed.currency) {
    document.getElementById('currency').value = parsed.currency;
  }

  const noteInput = document.getElementById('note');
  const prefix = `notify:${item.id}`;
  if (!noteInput.value.includes(prefix)) {
    noteInput.value = noteInput.value ? `${noteInput.value} | ${prefix}` : prefix;
  }

  const all = document.querySelectorAll('#notify-list .item');
  all.forEach(x => x.classList.remove('active'));
  const active = document.getElementById('notify-' + item.id);
  if (active) active.classList.add('active');
}

function setGiveMode() {
  document.getElementById('action-type').value = 'give';
}

function setTakeMode() {
  document.getElementById('action-type').value = 'take';
}

function setHalfAmount() {
  const amountInput = document.getElementById('amount');
  const current = parseFloat(amountInput.value);
  if (!current || current <= 0) return;
  amountInput.value = (current / 2).toFixed(2);
}

async function loadNotifications() {
  const container = document.getElementById('notify-list');
  if (!container) return;

  try {
    const rows = await request('/api/notifications/inbox?unackedOnly=true&take=20');

    for (const r of rows) {
      if (!seenNotificationIds.has(r.id)) {
        seenNotificationIds.add(r.id);
        await showBrowserNotification(r);
      }
    }
    rememberSeenIds();

    if (!rows.length) {
      selectedNotificationId = null;
      document.getElementById('selected-notify-box').style.display = 'none';
      container.innerHTML = '<div class="item">Yangi bildirishnoma yo\'q</div>';
      return;
    }

    const rowsById = new Map(rows.map(r => [r.id, r]));
    container.innerHTML = rows.map(r => {
      const when = new Date(r.createdAt).toLocaleString();
      return `<div class="item" id="notify-${r.id}"><strong>${r.title}</strong><div class="meta">${r.message}</div><div class="meta">${when} • ${r.createdByUserName}</div><div class="quick-row" style="margin-top:8px"><button type="button" class="sel-btn" data-id="${r.id}">Tanlash</button><button type="button" class="ack-btn" data-id="${r.id}">Qabul qildim</button><button type="button" class="half-btn" data-id="${r.id}">Yarmi</button></div></div>`;
    }).join('');

    container.querySelectorAll('.sel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = rowsById.get(btn.dataset.id);
        if (row) selectNotification(row);
      });
    });

    container.querySelectorAll('.ack-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        acknowledgeNotification(btn.dataset.id);
      });
    });

    container.querySelectorAll('.half-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = rowsById.get(btn.dataset.id);
        if (row) {
          selectNotification(row);
          setHalfAmount();
        }
      });
    });

    if (selectedNotificationId) {
      const selected = rows.find(x => x.id === selectedNotificationId);
      if (selected) {
        selectNotification(selected);
      } else {
        selectedNotificationId = null;
        document.getElementById('selected-notify-box').style.display = 'none';
      }
    }
  } catch (e) {
    container.innerHTML = `<div class="item">Xato: ${e.message}</div>`;
  }
}

async function restore() {
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) {
    clearSession();
    return;
  }

  try {
    session = JSON.parse(raw);
    await request('/api/auth/me');
    authCard.style.display = 'none';
    actionCard.style.display = 'block';
    loadActions();
    loadNotifications();
    startNotificationsPolling();
    connectNotificationsRealtime();
  } catch {
    clearSession();
  }
}

document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('save-btn').addEventListener('click', saveAction);
document.getElementById('logout-btn').addEventListener('click', clearSession);
document.getElementById('set-give-btn').addEventListener('click', setGiveMode);
document.getElementById('set-take-btn').addEventListener('click', setTakeMode);
document.getElementById('set-half-btn').addEventListener('click', setHalfAmount);

registerWorkerServiceWorker();
askNotificationPermissionIfNeeded();
restore();
