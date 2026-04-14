const API_BASE = window.KursInfra ? window.KursInfra.resolveApiBase() : 'http://localhost:5075';
const AUTH_KEY = 'worker_auth';
const WORK_PROGRESS_KEY = 'worker_work_progress';
const SEEN_NOTIFY_KEY = 'worker_seen_notifications';

let session = null;
let swReg = null;
let notificationsTimer = null;
let notificationHub = null;
let currentWorks = [];
let activeWorkId = null;
let seenNotificationIds = new Set();
let workProgress = {};

const authCard = document.getElementById('auth-card');
const actionCard = document.getElementById('action-card');
const authMsg = document.getElementById('auth-msg');
const saveMsg = document.getElementById('save-msg');
const notifyList = document.getElementById('notify-list');

const workModal = document.getElementById('work-modal');
const closeWorkModalBtn = document.getElementById('close-work-modal-btn');
const modalWorkTitle = document.getElementById('modal-work-title');
const modalWorkMessage = document.getElementById('modal-work-message');
const modalWorkProgress = document.getElementById('modal-work-progress');
const workAmountInput = document.getElementById('work-amount');
const workCurrencyInput = document.getElementById('work-currency');
const submitWorkBtn = document.getElementById('submit-work-btn');
const completeWorkBtn = document.getElementById('complete-work-btn');

try {
  const seenRaw = localStorage.getItem(SEEN_NOTIFY_KEY);
  if (seenRaw) {
    const parsed = JSON.parse(seenRaw);
    if (Array.isArray(parsed)) seenNotificationIds = new Set(parsed);
  }
} catch {
  seenNotificationIds = new Set();
}

try {
  const progressRaw = localStorage.getItem(WORK_PROGRESS_KEY);
  if (progressRaw) {
    const parsed = JSON.parse(progressRaw);
    if (parsed && typeof parsed === 'object') {
      workProgress = parsed;
    }
  }
} catch {
  workProgress = {};
}

function setMsg(el, text, type = '') {
  el.textContent = text;
  el.className = 'msg ' + type;
}

function setConnectionStatus(text) {
  const el = document.getElementById('conn-status');
  if (el) el.textContent = 'Status: ' + text;
}

function rememberSeenIds() {
  try {
    localStorage.setItem(SEEN_NOTIFY_KEY, JSON.stringify(Array.from(seenNotificationIds).slice(-1000)));
  } catch {
    // Ignore storage issues.
  }
}

function saveWorkProgress() {
  try {
    localStorage.setItem(WORK_PROGRESS_KEY, JSON.stringify(workProgress));
  } catch {
    // Ignore storage issues.
  }
}

function getWorkProgress(id) {
  return {
    paid: Number(workProgress[id]?.paid || 0)
  };
}

function setWorkProgress(id, paid) {
  workProgress[id] = { paid: Math.max(0, Number(paid || 0)) };
  saveWorkProgress();
}

function clearWorkProgress(id) {
  delete workProgress[id];
  saveWorkProgress();
}

function normalizeAmount(value) {
  const amount = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(amount) ? amount : 0;
}

function parseWorkAmount(item) {
  const text = [item?.message, item?.title].filter(Boolean).join(' ');
  const match = text.match(/([\d][\d,]*(?:\.\d+)?)\s*(WON|USD)/i);
  if (!match) return { amount: null, currency: 'won' };

  return {
    amount: parseFloat(match[1].replace(/,/g, '')),
    currency: match[2].toLowerCase() === 'usd' ? 'usd' : 'won'
  };
}

function formatMoney(amount, currency) {
  const value = Number(amount || 0);
  if (currency === 'usd') {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`;
  }
  return `${Math.round(value).toLocaleString()} WON`;
}

function formatWorkProgress(item) {
  const parsed = parseWorkAmount(item);
  const paid = getWorkProgress(item.id).paid;
  const hasTotal = Number.isFinite(parsed.amount) && parsed.amount > 0;

  if (!hasTotal) {
    return {
      paid,
      remaining: null,
      ratio: 0,
      badge: 'Yangi',
      badgeClass: '',
      summary: `To'langan: ${formatMoney(paid, parsed.currency)}`,
      currency: parsed.currency,
      total: null
    };
  }

  const shownPaid = Math.min(paid, parsed.amount);
  const remaining = Math.max(parsed.amount - shownPaid, 0);
  const ratio = Math.min((shownPaid / parsed.amount) * 100, 100);

  let badge = 'Yangi';
  let badgeClass = '';
  if (remaining === 0) {
    badge = 'Yakunlangan';
    badgeClass = 'done';
  } else if (shownPaid > 0) {
    badge = 'Qisman';
    badgeClass = 'partial';
  }

  return {
    paid: shownPaid,
    remaining,
    ratio,
    badge,
    badgeClass,
    summary: `To'langan: ${formatMoney(shownPaid, parsed.currency)} · Berishi kerak: ${formatMoney(remaining, parsed.currency)}`,
    currency: parsed.currency,
    total: parsed.amount
  };
}

function getActiveWork() {
  if (!activeWorkId) return null;
  return currentWorks.find(x => x.id === activeWorkId) || null;
}

function openWorkModal(item) {
  activeWorkId = item.id;
  const progress = formatWorkProgress(item);

  modalWorkTitle.textContent = item.title || 'Ish';
  modalWorkMessage.textContent = item.message || '';
  modalWorkProgress.textContent = progress.summary;
  workCurrencyInput.value = progress.currency.toUpperCase();

  if (progress.remaining !== null && progress.remaining > 0) {
    workAmountInput.value = progress.remaining.toFixed(progress.currency === 'usd' ? 2 : 0);
  } else {
    workAmountInput.value = '';
  }

  workModal.style.display = 'flex';
  setMsg(saveMsg, '');
}

function closeWorkModal() {
  activeWorkId = null;
  workModal.style.display = 'none';
}

async function showBrowserNotification(item) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const title = item.title || 'Yangi ish';
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

    session = payload;
    localStorage.setItem(AUTH_KEY, JSON.stringify(payload));
    authCard.style.display = 'none';
    actionCard.style.display = 'block';

    setConnectionStatus('connecting realtime...');
    await loadWorks();
    startPolling();
    connectRealtime();

    setMsg(authMsg, 'Kirish muvaffaqiyatli', 'ok');
  } catch (e) {
    setMsg(authMsg, 'Login xato: ' + e.message, 'err');
  }
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
  currentWorks = [];
  activeWorkId = null;
  localStorage.removeItem(AUTH_KEY);
  authCard.style.display = 'block';
  actionCard.style.display = 'none';
  notifyList.innerHTML = '';
  closeWorkModal();
  setMsg(saveMsg, '');
}

function startPolling() {
  if (notificationsTimer) clearInterval(notificationsTimer);
  notificationsTimer = setInterval(loadWorks, 30000);
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
      // Ignore.
    }
  }
}

async function acknowledgeNotification(id) {
  await request(`/api/notifications/${id}/ack`, { method: 'POST' });
}

async function postWorkPayment(item, amount, completeWork) {
  const parsed = parseWorkAmount(item);
  const currency = parsed.currency;
  const note = completeWork ? `work:${item.id} complete` : `work:${item.id} partial`;

  await request('/api/workercashactions', {
    method: 'POST',
    body: {
      actionType: 'give',
      amount,
      currency,
      note,
      actionAt: new Date().toISOString()
    }
  });
}

function renderWorks(items) {
  if (!items.length) {
    notifyList.innerHTML = '<div class="item">Yangi ish yo\'q</div>';
    return;
  }

  notifyList.innerHTML = items.map(item => {
    const progress = formatWorkProgress(item);

    return `
      <div class="item" id="notify-${item.id}">
        <div class="work-item-head">
          <div style="flex:1;min-width:0">
            <div class="work-item-title">${item.title}</div>
            <div class="meta">${item.message}</div>
            <div class="meta">${new Date(item.createdAt).toLocaleString()} • ${item.createdByUserName}</div>
          </div>
          <button type="button" class="enter-btn" data-id="${item.id}">Enter</button>
        </div>
        <div class="work-badge ${progress.badgeClass}">${progress.badge}</div>
        <div class="work-summary">${progress.summary}</div>
        ${progress.total ? `<div class="progress-track"><div class="progress-fill" style="width:${progress.ratio}%"></div></div>` : ''}
      </div>
    `;
  }).join('');

  notifyList.querySelectorAll('.enter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = currentWorks.find(x => x.id === btn.dataset.id);
      if (item) openWorkModal(item);
    });
  });
}

async function loadWorks() {
  try {
    const rows = await request('/api/notifications/inbox?unackedOnly=true&take=50');
    currentWorks = rows || [];

    for (const row of currentWorks) {
      if (!seenNotificationIds.has(row.id)) {
        seenNotificationIds.add(row.id);
        await showBrowserNotification(row);
      }
    }
    rememberSeenIds();

    renderWorks(currentWorks);

    if (activeWorkId) {
      const active = getActiveWork();
      if (active) {
        const progress = formatWorkProgress(active);
        modalWorkProgress.textContent = progress.summary;
      } else {
        closeWorkModal();
      }
    }
  } catch (e) {
    notifyList.innerHTML = `<div class="item">Xato: ${e.message}</div>`;
  }
}

async function connectRealtime() {
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
    loadWorks();
  });

  notificationHub.on('notification_acknowledged', () => {
    loadWorks();
  });

  try {
    await notificationHub.start();
    setConnectionStatus('realtime connected');
  } catch {
    setConnectionStatus('polling fallback');
  }
}

async function submitWorkPayment(forceComplete = false) {
  const item = getActiveWork();
  if (!item) {
    setMsg(saveMsg, 'Ish tanlanmagan', 'err');
    return;
  }

  const parsed = parseWorkAmount(item);
  const progress = getWorkProgress(item.id);
  const total = Number(parsed.amount || 0);
  const entered = normalizeAmount(workAmountInput.value);

  let addAmount = entered;
  if (forceComplete && total > 0) {
    addAmount = Math.max(total - progress.paid, 0);
  }

  if (!addAmount || addAmount <= 0) {
    setMsg(saveMsg, 'Miqdor kiriting', 'err');
    return;
  }

  try {
    await postWorkPayment(item, addAmount, forceComplete);

    const nextPaid = progress.paid + addAmount;
    if (total > 0) {
      if (nextPaid >= total || forceComplete) {
        clearWorkProgress(item.id);
        await acknowledgeNotification(item.id);
        setMsg(saveMsg, 'Ish yakunlandi. VIP xabardor qilindi.', 'ok');
        closeWorkModal();
      } else {
        setWorkProgress(item.id, nextPaid);
        setMsg(saveMsg, `Qo'shildi. Berishi kerak: ${formatMoney(Math.max(total - nextPaid, 0), parsed.currency)}`, 'ok');
      }
    } else {
      setWorkProgress(item.id, nextPaid);
      setMsg(saveMsg, `Qo'shildi: ${formatMoney(addAmount, parsed.currency)}`, 'ok');
    }

    workAmountInput.value = '';
    await loadWorks();
  } catch (e) {
    setMsg(saveMsg, 'Saqlash xato: ' + e.message, 'err');
  }
}

async function completeWork() {
  const item = getActiveWork();
  if (!item) {
    setMsg(saveMsg, 'Ish tanlanmagan', 'err');
    return;
  }

  const parsed = parseWorkAmount(item);
  const progress = getWorkProgress(item.id);
  const total = Number(parsed.amount || 0);

  if (total > 0) {
    const remaining = Math.max(total - progress.paid, 0);
    if (remaining > 0) {
      workAmountInput.value = remaining.toFixed(parsed.currency === 'usd' ? 2 : 0);
      await submitWorkPayment(true);
      return;
    }
  }

  try {
    await acknowledgeNotification(item.id);
    clearWorkProgress(item.id);
    closeWorkModal();
    setMsg(saveMsg, 'Ish yakunlandi. VIP xabardor qilindi.', 'ok');
    await loadWorks();
  } catch (e) {
    setMsg(saveMsg, 'Yakunlash xato: ' + e.message, 'err');
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
    setConnectionStatus('restoring session');
    await loadWorks();
    startPolling();
    connectRealtime();
  } catch {
    clearSession();
  }
}

document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('logout-btn').addEventListener('click', clearSession);
closeWorkModalBtn.addEventListener('click', closeWorkModal);
submitWorkBtn.addEventListener('click', () => submitWorkPayment(false));
completeWorkBtn.addEventListener('click', completeWork);
workAmountInput.addEventListener('keydown', async event => {
  if (event.key === 'Enter') {
    await submitWorkPayment(false);
  }
});
workModal.addEventListener('click', event => {
  if (event.target === workModal) closeWorkModal();
});

registerWorkerServiceWorker();
askNotificationPermissionIfNeeded();
restore();
