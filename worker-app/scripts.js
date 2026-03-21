const API_BASE = resolveApiBase();
const AUTH_KEY = 'worker_auth';
const SEEN_NOTIFY_KEY = 'worker_seen_notifications';
let session = null;
let swReg = null;

function resolveApiBase() {
  const fromStorage = (localStorage.getItem('api_base') || '').trim();
  if (fromStorage) return fromStorage.replace(/\/$/, '');

  const fromMeta = (document.querySelector('meta[name="api-base"]')?.getAttribute('content') || '').trim();
  if (fromMeta) return fromMeta.replace(/\/$/, '');

  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:5075';
  }

  return window.location.origin.replace(/\/$/, '');
}

const authCard = document.getElementById('auth-card');
const actionCard = document.getElementById('action-card');
const authMsg = document.getElementById('auth-msg');
const saveMsg = document.getElementById('save-msg');
let notificationsTimer = null;
let seenNotificationIds = new Set();

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
  loadActions();
  loadNotifications();
  startNotificationsPolling();
}

function clearSession() {
  if (notificationsTimer) {
    clearInterval(notificationsTimer);
    notificationsTimer = null;
  }
  session = null;
  localStorage.removeItem(AUTH_KEY);
  authCard.style.display = 'block';
  actionCard.style.display = 'none';
}

function startNotificationsPolling() {
  if (notificationsTimer) clearInterval(notificationsTimer);
  notificationsTimer = setInterval(loadNotifications, 15000);
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
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;

  const res = await fetch(API_BASE + path, { ...options, headers });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof data === 'string' ? data : (data?.title || data?.message || 'Server error');
    throw new Error(msg);
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
  const actionType = document.getElementById('action-type').value;
  const amount = parseFloat(document.getElementById('amount').value);
  const currency = document.getElementById('currency').value;
  const note = document.getElementById('note').value.trim();

  if (!amount || amount <= 0) {
    setMsg(saveMsg, 'Miqdor > 0 bo\'lishi kerak', 'err');
    return;
  }

  try {
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
      container.innerHTML = '<div class="item">Yangi bildirishnoma yo\'q</div>';
      return;
    }

    container.innerHTML = rows.map(r => {
      const when = new Date(r.createdAt).toLocaleString();
      return `<div class="item"><strong>${r.title}</strong><div class="meta">${r.message}</div><div class="meta">${when} • ${r.createdByUserName}</div><button onclick="acknowledgeNotification('${r.id}')">Qabul qildim</button></div>`;
    }).join('');
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
  } catch {
    clearSession();
  }
}

document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('save-btn').addEventListener('click', saveAction);
document.getElementById('logout-btn').addEventListener('click', clearSession);

registerWorkerServiceWorker();
askNotificationPermissionIfNeeded();
restore();
