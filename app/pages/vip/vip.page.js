// ===== DATA STORE =====
const AUTH_KEY = 'kurs_auth';
const API_BASE = window.KursInfra ? window.KursInfra.resolveApiBase() : 'http://localhost:5075';
const inviteToken = new URLSearchParams(window.location.search).get('invite');
const requestedPage = new URLSearchParams(window.location.search).get('page');
const NOTIFY_OUTBOX_KEY = 'kurs_notify_outbox';
const NOTIFIED_TXN_KEY = 'kurs_notified_latest';
const REPORT_MONTH_KEY = 'kurs_report_month';

let DB = {
  customers: [],
  transactions: [],
  expenses: [],
  profits: []
};

// Load from localStorage
try {
  const saved = localStorage.getItem('kurs_db');
  if (saved) DB = { ...DB, ...JSON.parse(saved) };
} catch(e) {}

function save() {
  try { localStorage.setItem('kurs_db', JSON.stringify(DB)); } catch(e) {}
}

function saveNotifyOutbox() {
  try { localStorage.setItem(NOTIFY_OUTBOX_KEY, JSON.stringify(notifyOutbox)); } catch(e) {}
}

function saveNotifiedLatestMap() {
  try { localStorage.setItem(NOTIFIED_TXN_KEY, JSON.stringify(notifiedLatestByTxn)); } catch(e) {}
}

function getTransactionById(txnId) {
  return DB.transactions.find(t => t.id === txnId) || null;
}

function getLatestTransaction() {
  if (!DB.transactions.length) return null;
  return [...DB.transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

function getCustomerNameById(customerId) {
  const c = DB.customers.find(x => x.id === customerId);
  return c?.name || 'Noma\'lum mijoz';
}

function formatTxnSummary(txn) {
  const customerName = getCustomerNameById(txn.customerId);
  const amountLabel = txn.type === 'won'
    ? `${Math.round(txn.amount).toLocaleString()} WON`
    : `${txn.amount.toLocaleString()} USD`;
  return `${customerName} · ${amountLabel} · kurs ${txn.rate}`;
}

function getNotifyModeLabel(mode) {
  return mode === 'manual' ? 'manual' : 'latest';
}

function getCurrentReportMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getLatestReportMonthFromData() {
  const rows = [...DB.expenses, ...DB.profits]
    .map(parseReportDate)
    .filter(Boolean)
    .sort((a, b) => b - a);

  if (rows.length === 0) {
    return getCurrentReportMonth();
  }

  const latest = rows[0];
  return `${latest.getFullYear()}-${String(latest.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeReportMonth(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return getCurrentReportMonth();

  const month = Math.min(12, Math.max(1, Number(match[2])));
  return `${match[1]}-${String(month).padStart(2, '0')}`;
}

function getReportMonth() {
  const input = document.getElementById('report-month-input');
  return normalizeReportMonth(input?.value || reportMonth);
}

function getRecordReportDate(record) {
  return record?.date || record?.createdAt || '';
}

function parseReportDate(record) {
  const raw = getRecordReportDate(record);
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isRecordInSelectedMonth(record, monthKey) {
  const date = parseReportDate(record);
  if (!date) return false;
  const candidate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return candidate === normalizeReportMonth(monthKey);
}

function getWeekBucketForRecord(record) {
  const date = parseReportDate(record);
  if (!date) return 4;
  return Math.min(4, Math.floor((date.getDate() - 1) / 7) + 1);
}

function formatReportMoney(value) {
  return Math.round(value).toLocaleString();
}

function buildFourWeekSummary(rows) {
  return [1, 2, 3, 4].map(week => {
    const weekRows = rows.filter(row => getWeekBucketForRecord(row) === week);
    const wonTotal = weekRows.filter(row => row.currency === 'won').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const usdTotal = weekRows.filter(row => row.currency === 'usd').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const wonEquivalent = wonTotal + (usdTotal * 1350);

    return {
      week,
      count: weekRows.length,
      wonTotal,
      usdTotal,
      wonEquivalent
    };
  });
}

function setReportMonth(monthValue, silent = false) {
  reportMonth = normalizeReportMonth(monthValue);
  try {
    localStorage.setItem(REPORT_MONTH_KEY, reportMonth);
  } catch {
    // Ignore storage errors.
  }
  const input = document.getElementById('report-month-input');
  if (input && input.value !== reportMonth) {
    input.value = reportMonth;
  }

  if (!silent) {
    renderExpenses();
    renderProfits();
    renderAnalyticsStats();
    refreshReportsPageIfOpen();
    syncReportDataFromServer();
  }
}

function buildAuthHeaders(extraHeaders = {}, includeJsonContentType = true) {
  const headers = {
    ...(includeJsonContentType ? { 'Content-Type': 'application/json' } : {}),
    ...extraHeaders
  };

  if (authSession?.token) {
    headers.Authorization = `Bearer ${authSession.token}`;
  }

  return headers;
}

async function fetchWithAuth(path, options = {}, includeJsonContentType = true) {
  return fetch(API_BASE + path, {
    ...options,
    headers: buildAuthHeaders(options.headers || {}, includeJsonContentType)
  });
}

async function apiRequestBlob(path, options = {}) {
  const response = await fetchWithAuth(path, options, true);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Server error');
  }

  return response.blob();
}

async function apiRequestFormData(path, formData, options = {}) {
  const response = await fetchWithAuth(path, {
    ...options,
    method: options.method || 'POST',
    body: formData
  }, false);

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(typeof body === 'string' ? body : (body?.title || body?.message || 'Server error'));
  }

  return body;
}

function mapServerReportItem(item, fallbackPrefix) {
  return {
    id: item.id || `${fallbackPrefix}_${Date.now()}`,
    desc: item.description || '',
    amount: Number(item.amount) || 0,
    currency: item.currency || 'won',
    cat: item.category || 'Boshqa',
    date: item.date || item.createdAt || new Date().toISOString(),
    createdAt: item.createdAt || new Date().toISOString()
  };
}

function toReportEntryPayload(item) {
  return {
    description: item.desc,
    amount: Number(item.amount) || 0,
    currency: item.currency,
    category: item.cat,
    date: item.date || item.createdAt || new Date().toISOString(),
    createdAt: item.createdAt || new Date().toISOString()
  };
}

async function syncReportDataFromServer() {
  if (!authSession || !navigator.onLine) {
    return false;
  }

  try {
    const snapshot = await apiRequest(`/api/reports/snapshot?month=${encodeURIComponent(getReportMonth())}`);
    DB.expenses = Array.isArray(snapshot.expenses) ? snapshot.expenses.map(item => mapServerReportItem(item, 'e')) : [];
    DB.profits = Array.isArray(snapshot.profits) ? snapshot.profits.map(item => mapServerReportItem(item, 'p')) : [];
    save();
    renderExpenses();
    renderProfits();
    renderAnalyticsStats();
    renderReportsOverview();
    return true;
  } catch {
    return false;
  }
}

// ===== STATE =====
let selectedCustomer = null;
let txnType = 'won';
let analyticsCustomer = null;
let scene, camera, renderer, pieGroup;
let animFrameId;
let authSession = null;
let lastSavedTransaction = null;
let notifyWorkers = [];
let notifyModalMode = 'latest';
let notifyOutbox = [];
let notifiedLatestByTxn = {};
let reportMonth = normalizeReportMonth(localStorage.getItem(REPORT_MONTH_KEY) || getCurrentReportMonth());

try {
  const rawOutbox = localStorage.getItem(NOTIFY_OUTBOX_KEY);
  if (rawOutbox) {
    const parsed = JSON.parse(rawOutbox);
    if (Array.isArray(parsed)) notifyOutbox = parsed;
  }
} catch {
  notifyOutbox = [];
}

try {
  const rawNotified = localStorage.getItem(NOTIFIED_TXN_KEY);
  if (rawNotified) {
    const parsed = JSON.parse(rawNotified);
    if (parsed && typeof parsed === 'object') notifiedLatestByTxn = parsed;
  }
} catch {
  notifiedLatestByTxn = {};
}

// ===== NAVIGATION =====
function switchPage(p) {
  if (!canAccessPage(p)) {
    showToast('Bu sahifa sizning role uchun yopiq', 'error');
    return;
  }
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('active'));
  document.getElementById('page-' + p).classList.add('active');
  const navButton = document.getElementById('nav-' + p);
  if (navButton) {
    navButton.classList.add('active');
  }
  if (p === 'analytics') { setTimeout(initAnalytics, 50); }
  if (p === 'expenses') { renderExpenses(); }
  if (p === 'profits') { renderProfits(); }
  if (p === 'reports') { renderReportsPage(); }
  if (p === 'developer') { refreshDeveloperOverview(); }
}

function canAccessPage(pageName) {
  if (!authSession) return false;
  const role = (authSession.role || '').toLowerCase();
  if (role === 'vip' || role === 'developer') return true;
  if (role === 'worker') return pageName === 'txn';
  return false;
}

function applyRoleUi() {
  const role = (authSession?.role || '').toLowerCase();
  const navMap = {
    txn: document.getElementById('nav-txn'),
    analytics: document.getElementById('nav-analytics'),
    expenses: document.getElementById('nav-expenses'),
    profits: document.getElementById('nav-profits'),
    invite: document.getElementById('nav-invite'),
    developer: document.getElementById('nav-developer')
  };

  if (role === 'worker') {
    navMap.analytics.style.display = 'none';
    navMap.expenses.style.display = 'none';
    navMap.profits.style.display = 'none';
    navMap.invite.style.display = 'none';
    navMap.developer.style.display = 'none';
    switchPage('txn');
    return;
  }

  navMap.analytics.style.display = '';
  navMap.expenses.style.display = '';
  navMap.profits.style.display = '';
  navMap.invite.style.display = '';

  if (role === 'developer') {
    navMap.developer.style.display = '';
  } else {
    navMap.developer.style.display = 'none';
    if (document.getElementById('page-developer').classList.contains('active')) {
      switchPage('txn');
    }
  }
}

function switchAuthTab(tab) {
  document.getElementById('auth-tab-login').className = 'auth-tab' + (tab === 'login' ? ' active' : '');
  document.getElementById('auth-tab-register').className = 'auth-tab' + (tab === 'register' ? ' active' : '');
  document.getElementById('auth-login-panel').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('auth-register-panel').style.display = tab === 'register' ? 'block' : 'none';
}

async function setupInviteRegistrationMode() {
  const registerTab = document.getElementById('auth-tab-register');
  const banner = document.getElementById('invite-banner');
  if (!inviteToken) {
    registerTab.style.display = 'none';
    return;
  }

  registerTab.style.display = 'block';
  banner.style.display = 'block';
  banner.textContent = 'Invite link aniqlandi. Faqat Worker ro\'yxatdan o\'tishi mumkin.';
  switchAuthTab('register');

  try {
    const res = await apiRequest('/api/invites/worker/validate?token=' + encodeURIComponent(inviteToken));
    if (!res.valid) {
      banner.textContent = 'Invite token yaroqsiz: ' + (res.reason || 'Noma\'lum xato');
      document.getElementById('register-username').disabled = true;
      document.getElementById('register-password').disabled = true;
    }
  } catch {
    banner.textContent = 'Invite tokenni tekshirishda xato.';
  }
}

function setAuthSession(payload) {
  authSession = {
    token: payload.token,
    expiresAtUtc: payload.expiresAtUtc,
    role: payload.role,
    userName: payload.userName
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(authSession));
  showAppShell();
}

function clearAuthSession() {
  authSession = null;
  localStorage.removeItem(AUTH_KEY);
  showAuthScreen();
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('session-bar').style.display = 'none';
  document.getElementById('app').style.visibility = 'hidden';
}

function showAppShell() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('session-bar').style.display = 'flex';
  document.getElementById('app').style.visibility = 'visible';
  document.getElementById('session-user').textContent = `${authSession.userName} (${authSession.role})`;
  applyRoleUi();
  askVipNotificationPermission();
  flushNotifyOutbox();
  syncReportDataFromServer();

  if (requestedPage) {
    const page = requestedPage.toLowerCase();
    if (canAccessPage(page)) {
      setTimeout(() => switchPage(page), 0);
    }
  }
}

async function apiRequest(path, options = {}) {
  if (window.KursInfra?.apiRequest) {
    return window.KursInfra.apiRequest(API_BASE, path, {
      ...options,
      token: authSession?.token
    });
  }

  const response = await fetchWithAuth(path, options);
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(typeof body === 'string' ? body : (body?.title || body?.message || 'Server error'));
  }
  return body;
}

async function registerWorkerUser() {
  const userName = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value.trim();

  if (!userName || !password) {
    showToast('Username va parol kiriting', 'error');
    return;
  }

  if (!inviteToken) {
    showToast('Ro\'yxatdan o\'tish faqat invite link orqali', 'error');
    return;
  }

  try {
    const payload = await apiRequest('/api/auth/register-worker', {
      method: 'POST',
      body: JSON.stringify({ userName, password, inviteToken })
    });
    setAuthSession(payload);
    showToast('Worker ro\'yxatdan o\'tdi', 'success');
  } catch (e) {
    showToast('Register xato: ' + e.message, 'error');
  }
}

async function loginUser() {
  const userName = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();

  if (!userName || !password) {
    showToast('Username va parol kiriting', 'error');
    return;
  }

  try {
    const payload = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ userName, password })
    });
    setAuthSession(payload);
    showToast('Kirish muvaffaqiyatli', 'success');
  } catch (e) {
    showToast('Login xato: ' + e.message, 'error');
  }
}

async function checkExistingSession() {
  const raw = localStorage.getItem(AUTH_KEY);
  document.getElementById('auth-api-url').textContent = API_BASE;
  if (!raw) {
    showAuthScreen();
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    authSession = parsed;
    await apiRequest('/api/auth/me');
    showAppShell();
  } catch {
    clearAuthSession();
  }
}

function logoutUser() {
  clearAuthSession();
  showToast('Session yopildi', 'success');
}

async function registerVipServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch {
    // Ignore SW registration errors in unsupported hosting contexts.
  }
}

async function askVipNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {
      // Ignore permission errors.
    }
  }
}

function shouldQueueNotifyError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return !navigator.onLine
    || msg.includes('failed to fetch')
    || msg.includes('network')
    || msg.includes('timeout');
}

function buildNotifyPayload(txn, workerId, mode) {
  const customerName = getCustomerNameById(txn.customerId);
  const amountLabel = txn.type === 'won'
    ? `${Math.round(txn.amount).toLocaleString()} WON`
    : `${txn.amount.toLocaleString()} USD`;
  const convertedLabel = txn.type === 'won'
    ? `${(txn.convertedAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`
    : `${Math.round(txn.convertedAmount || 0).toLocaleString()} WON`;

  return {
    title: 'Yangi pul harakati',
    message: `${customerName}: ${amountLabel}, kurs ${txn.rate}, auto ${convertedLabel}`,
    relatedType: 'transaction',
    relatedId: txn.id,
    targetRole: 'Worker',
    targetUserId: workerId,
    isLatestTransaction: mode === 'latest',
    transactionCreatedAtUtc: mode === 'latest' ? txn.createdAt : null
  };
}

function markLatestNotified(txnId) {
  notifiedLatestByTxn[txnId] = {
    notifiedAt: new Date().toISOString()
  };
  saveNotifiedLatestMap();
}

function isLatestNotifyBlocked(txn) {
  if (!txn) return { blocked: true, reason: 'Avval tranzaksiya saqlang' };

  const ageMs = Date.now() - new Date(txn.createdAt).getTime();
  if (ageMs > 60 * 60 * 1000) {
    return { blocked: true, reason: 'Latest tranzaksiya 1 soatdan eski' };
  }

  if (notifiedLatestByTxn[txn.id]) {
    return { blocked: true, reason: 'Bu latest tranzaksiya allaqachon notify qilingan' };
  }

  return { blocked: false, reason: '' };
}

function isLatestPayloadExpired(payload) {
  if (!payload?.isLatestTransaction || !payload?.transactionCreatedAtUtc) return false;
  const ageMs = Date.now() - new Date(payload.transactionCreatedAtUtc).getTime();
  return ageMs > 60 * 60 * 1000;
}

function shouldDropNotifyError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('already been notified')
    || msg.includes('older than 1 hour')
    || msg.includes('active notification for this transaction');
}

async function loadWorkersForNotify() {
  const select = document.getElementById('notify-worker-select');
  select.innerHTML = '<option value="">Worker tanlang...</option>';

  const rows = await apiRequest('/api/auth/workers');
  notifyWorkers = Array.isArray(rows) ? rows : [];
  notifyWorkers.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.userName;
    select.appendChild(opt);
  });
}

function loadTransactionsForNotify(mode) {
  const customerSelect = document.getElementById('notify-customer-select');
  const select = document.getElementById('notify-transaction-select');
  select.innerHTML = '<option value="">Tranzaksiya tanlang...</option>';

  const customerId = customerSelect ? customerSelect.value : '';
  let rows = [...DB.transactions];

  if (mode === 'manual' && customerId) {
    rows = rows.filter(t => t.customerId === customerId);
  }

  rows = rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  rows = mode === 'latest' ? rows.slice(0, 1) : rows;

  rows.forEach(txn => {
    const opt = document.createElement('option');
    opt.value = txn.id;
    opt.textContent = formatTxnSummary(txn);
    select.appendChild(opt);
  });

  if (rows.length) {
    select.value = rows[0].id;
  }
}

function loadCustomersForNotify(mode) {
  const select = document.getElementById('notify-customer-select');
  if (!select) return;

  select.innerHTML = '<option value="">Barcha mijozlar</option>';
  if (mode !== 'manual') {
    select.value = '';
    return;
  }

  const usedCustomerIds = new Set(DB.transactions.map(t => t.customerId));
  const rows = DB.customers
    .filter(c => usedCustomerIds.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  rows.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

function onNotifyCustomerChange() {
  if (notifyModalMode !== 'manual') return;
  loadTransactionsForNotify('manual');
  updateNotifyPreview();
}

function updateNotifyPreview() {
  const workerId = document.getElementById('notify-worker-select').value;
  const txnId = document.getElementById('notify-transaction-select').value;
  const preview = document.getElementById('notify-preview');

  const worker = notifyWorkers.find(w => w.id === workerId);
  const txn = getTransactionById(txnId);

  if (!worker || !txn) {
    preview.textContent = 'Tanlashni kutmoqda...';
    return;
  }

  preview.textContent = `${worker.userName} -> ${formatTxnSummary(txn)}`;
}

function setNotifyModalError(msg) {
  const box = document.getElementById('notify-modal-msg');
  if (!msg) {
    box.style.display = 'none';
    box.textContent = '';
    return;
  }
  box.style.display = 'block';
  box.textContent = msg;
}

async function openNotifyModal(mode) {
  if (!authSession) {
    showToast('Avval tizimga kiring', 'error');
    return;
  }

  const role = (authSession.role || '').toLowerCase();
  if (role === 'worker') {
    showToast('Worker notify yubora olmaydi', 'error');
    return;
  }

  notifyModalMode = mode === 'manual' ? 'manual' : 'latest';
  const latestTxn = getLatestTransaction();
  if (!latestTxn && notifyModalMode === 'latest') {
    showToast('Avval tranzaksiya saqlang', 'error');
    return;
  }

  if (notifyModalMode === 'latest') {
    const guard = isLatestNotifyBlocked(latestTxn);
    if (guard.blocked) {
      showToast(guard.reason, 'error');
      return;
    }
  }

  try {
    await loadWorkersForNotify();
    loadCustomersForNotify(notifyModalMode);
    loadTransactionsForNotify(notifyModalMode);
    const title = document.getElementById('notify-modal-title');
    const customerGroup = document.getElementById('notify-customer-group');
    if (title) {
      title.textContent = notifyModalMode === 'manual'
        ? 'WORKERGA NOTIFY (TRANZAKSIYA TANLANG)'
        : 'WORKERGA NOTIFY (LATEST)';
    }
    if (customerGroup) {
      customerGroup.style.display = notifyModalMode === 'manual' ? 'block' : 'none';
    }
    setNotifyModalError('');
    updateNotifyPreview();
    document.getElementById('notify-modal').classList.add('open');
  } catch (e) {
    showToast('Worker ro\'yxatini olishda xato: ' + e.message, 'error');
  }
}

function closeNotifyModal() {
  document.getElementById('notify-modal').classList.remove('open');
  setNotifyModalError('');
}

async function sendNotifyPayload(payload, txnId, mode) {
  await apiRequest('/api/notifications', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (mode === 'latest') {
    markLatestNotified(txnId);
  }
}

async function sendNotifyFromModal() {
  const workerId = document.getElementById('notify-worker-select').value;
  const txnId = document.getElementById('notify-transaction-select').value;
  const txn = getTransactionById(txnId);

  if (!workerId) {
    setNotifyModalError('Worker tanlang.');
    return;
  }

  if (!txn) {
    setNotifyModalError('Tranzaksiya topilmadi.');
    return;
  }

  if (notifyModalMode === 'latest') {
    const latestTxn = getLatestTransaction();
    if (!latestTxn || latestTxn.id !== txn.id) {
      setNotifyModalError('Latest tranzaksiya o\'zgargan. Qayta oching.');
      return;
    }

    const guard = isLatestNotifyBlocked(latestTxn);
    if (guard.blocked) {
      setNotifyModalError(guard.reason);
      return;
    }
  }

  const mode = getNotifyModeLabel(notifyModalMode);
  const payload = buildNotifyPayload(txn, workerId, mode);

  try {
    await sendNotifyPayload(payload, txn.id, mode);
    showToast('Worker ga notify yuborildi', 'success');
    closeNotifyModal();
  } catch (e) {
    if (shouldQueueNotifyError(e)) {
      notifyOutbox.push({
        payload,
        txnId: txn.id,
        mode,
        createdAt: new Date().toISOString()
      });
      saveNotifyOutbox();
      showToast('Offline: notify queue ga saqlandi', 'success');
      closeNotifyModal();
      return;
    }

    setNotifyModalError('Notify xato: ' + e.message);
  }
}

async function flushNotifyOutbox() {
  if (!notifyOutbox.length || !authSession) return;
  const pending = [...notifyOutbox];
  const failed = [];

  for (const item of pending) {
    const mode = getNotifyModeLabel(item.mode);

    if (mode === 'latest' && isLatestPayloadExpired(item.payload)) {
      continue;
    }

    try {
      await sendNotifyPayload(item.payload, item.txnId, mode);
    } catch (e) {
      if (mode === 'latest' && shouldDropNotifyError(e)) {
        markLatestNotified(item.txnId);
        continue;
      }

      if (shouldDropNotifyError(e)) {
        continue;
      }

      failed.push(item);
    }
  }

  notifyOutbox = failed;
  saveNotifyOutbox();
}

async function generateWorkerInviteLink() {
  if (!authSession) {
    showToast('Avval tizimga kiring', 'error');
    return;
  }
  const role = (authSession.role || '').toLowerCase();
  if (role !== 'vip' && role !== 'developer') {
    showToast('Invite yaratish uchun ruxsat yo\'q', 'error');
    return;
  }

  const hours = parseInt(document.getElementById('invite-exp-hours').value, 10) || 24;
  try {
    const res = await apiRequest('/api/invites/worker', {
      method: 'POST',
      body: JSON.stringify({ expiresInHours: hours })
    });
    document.getElementById('invite-link-output').value = res.link;
    showToast('Invite link yaratildi', 'success');
  } catch (e) {
    showToast('Invite xato: ' + e.message, 'error');
  }
}

async function copyWorkerInviteLink() {
  const value = document.getElementById('invite-link-output').value;
  if (!value) {
    showToast('Avval link yarating', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast('Link nusxalandi', 'success');
  } catch {
    showToast('Nusxalashda xato', 'error');
  }
}

async function refreshDeveloperOverview() {
  if (!authSession || (authSession.role || '').toLowerCase() !== 'developer') {
    return;
  }

  try {
    const data = await apiRequest('/api/developer/overview');
    document.getElementById('dev-status').textContent = `DB: ${data.dbConnected ? 'connected' : 'disconnected'} · UTC: ${new Date(data.serverTimeUtc).toLocaleString()}`;
    document.getElementById('dev-users-total').textContent = data.users.total;
    document.getElementById('dev-users-by-role').textContent = `W:${data.users.workers} V:${data.users.vips} D:${data.users.developers}`;
    document.getElementById('dev-invites-total').textContent = data.invites.total;
    document.getElementById('dev-invites-meta').textContent = `Used:${data.invites.used} Exp:${data.invites.expired}`;
    document.getElementById('dev-notify-total').textContent = data.notifications.total;
    document.getElementById('dev-notify-unacked').textContent = `Unacked:${data.notifications.unacked}`;
    document.getElementById('dev-worker-actions').textContent = data.workerCashActions.total;
  } catch (e) {
    document.getElementById('dev-status').textContent = 'Developer overview xato: ' + e.message;
  }
}

async function cleanupExpiredInvites() {
  if (!authSession || (authSession.role || '').toLowerCase() !== 'developer') {
    showToast('Faqat developer uchun', 'error');
    return;
  }

  try {
    const res = await apiRequest('/api/developer/invites/cleanup', { method: 'POST' });
    showToast(`Cleanup done: ${res.deleted} ta`, 'success');
    refreshDeveloperOverview();
  } catch (e) {
    showToast('Cleanup xato: ' + e.message, 'error');
  }
}

// ===== CUSTOMER SEARCH =====
function searchCustomer(val, autoSelect = false) {
  const results = document.getElementById('search-results');
  const warn = document.getElementById('new-customer-warn');
  warn.style.display = 'none';
  if (!val.trim()) { results.style.display = 'none'; return; }

  const q = val.trim().toLowerCase();
  const matches = DB.customers.filter(c =>
    c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)
  );

  if (matches.length === 0) {
    results.style.display = 'none';
    showNewCustomerWarn(val.trim());
    return;
  }

  // Auto-select: exact name match OR only one result when called from smart input
  if (autoSelect) {
    const exact = matches.find(c => c.name.toLowerCase() === q);
    if (exact) { selectCustomer(exact.id); return; }
    if (matches.length === 1) { selectCustomer(matches[0].id); return; }
  }

  results.style.display = 'block';
  results.innerHTML = matches.slice(0, 5).map(c => `
    <div class="search-item" onclick="selectCustomer('${c.id}')">
      <div class="avatar">${c.name[0].toUpperCase()}</div>
      <div class="info">
        <div class="name">${c.name}</div>
        <div class="phone">${c.phone || 'Telefon yo\'q'}</div>
      </div>
    </div>
  `).join('');
}

function showNewCustomerWarn(val) {
  const warn = document.getElementById('new-customer-warn');
  warn.style.display = 'block';
  warn.innerHTML = `
    <div class="warn-banner fade-in">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <div class="warn-text">
        <strong>"${val}"</strong> — yangi mijoz?<br>
        <span style="font-size:11px">Agar yozuvda xatolik bo'lsa, tekshiring</span>
        <div class="warn-actions">
          <button class="btn btn-sm btn-primary" onclick="createAndSelectCustomer('${val}')">✓ Ha, yangi</button>
          <button class="btn btn-sm btn-secondary" onclick="document.getElementById('customer-search').value='';document.getElementById('new-customer-warn').style.display='none'">✕ Xato</button>
        </div>
      </div>
    </div>`;
}

function createAndSelectCustomer(rawVal) {
  const isPhone = /^\+?[\d\s-]{7,}$/.test(rawVal);
  // Pre-fill modal fields
  document.getElementById('nc-name').value = isPhone ? '' : rawVal;
  document.getElementById('nc-phone').value = isPhone ? rawVal : '';
  document.getElementById('new-customer-modal').classList.add('open');
  // focus the empty field
  setTimeout(() => {
    if (isPhone) document.getElementById('nc-name').focus();
    else document.getElementById('nc-phone').focus();
  }, 300);
}

// ===== PHONE VALIDATION =====
// Accepted formats:
//   Korean mobile: 010-XXXX-XXXX or 01XXXXXXXXX (11 digits starting 010/011/016/017/018/019)
//   Uzbek: +998XXXXXXXXX or 998XXXXXXXXX or 9XXXXXXXXX (9 digits local) or 09XXXXXXXX
function normalizePhone(raw) {
  const digits = raw.replace(/[\s\-().+]/g, '');
  // Korean: starts with 01, 11 digits
  if (/^01[016789]\d{7,8}$/.test(digits)) {
    return digits.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  // Uzbek with 998 prefix (12 digits)
  if (/^998\d{9}$/.test(digits)) {
    return '+' + digits;
  }
  // Uzbek local 9 digits starting with 9
  if (/^9[013789]\d{7}$/.test(digits)) {
    return '+998' + digits;
  }
  // Uzbek 0XX format (10 digits starting 09)
  if (/^0[9]\d{8}$/.test(digits)) {
    return '+998' + digits.slice(1);
  }
  return null; // invalid
}

function formatPhoneInput(input) {
  const val = input.value.trim();
  const hintId = input.id + '-hint';
  const hint = document.getElementById(hintId);
  if (!val) { if(hint) hint.style.display='none'; return; }
  const normalized = normalizePhone(val);
  if (normalized) {
    if(hint) { hint.textContent = '✓ ' + normalized; hint.style.color='var(--green)'; hint.style.display='block'; }
  } else if (val.replace(/[\s\-().+]/g,'').length >= 7) {
    if(hint) { hint.textContent = '⚠ Noto\'g\'ri format. Namuna: 01032235454 yoki +998901234567'; hint.style.color='var(--accent)'; hint.style.display='block'; }
  } else {
    if(hint) hint.style.display='none';
  }
}

function validatePhoneField(raw) {
  if (!raw.trim()) return { ok: true, value: '' }; // phone is optional
  const n = normalizePhone(raw);
  if (!n) return { ok: false, msg: 'Noto\'g\'ri telefon format. Koreya: 01032235454 · O\'zbek: +998901234567 yoki 901234567' };
  return { ok: true, value: n };
}

function isNameOrPhoneDuplicate(name, phone, excludeId) {
  const nameLow = name.toLowerCase();
  return DB.customers.find(c => {
    if (c.id === excludeId) return false;
    if (c.name.toLowerCase() === nameLow) return true;
    if (phone && c.phone && c.phone === phone) return true;
    return false;
  });
}

function confirmNewCustomer() {
  const name = document.getElementById('nc-name').value.trim();
  const rawPhone = document.getElementById('nc-phone').value.trim();
  if (!name) { showToast('Ismni kiriting!', 'error'); return; }

  const phoneResult = validatePhoneField(rawPhone);
  if (!phoneResult.ok) { showToast(phoneResult.msg, 'error'); return; }

  const dup = isNameOrPhoneDuplicate(name, phoneResult.value, null);
  if (dup) {
    showToast(`"${dup.name}" — bu mijoz allaqachon mavjud!`, 'error');
    return;
  }

  const customer = { id: 'c_' + Date.now(), name, phone: phoneResult.value, createdAt: new Date().toISOString() };
  DB.customers.push(customer);
  save();
  document.getElementById('new-customer-modal').classList.remove('open');
  document.getElementById('new-customer-warn').style.display = 'none';
  document.getElementById('nc-phone-hint').style.display = 'none';
  selectCustomer(customer.id);
  showToast('Yangi mijoz yaratildi: ' + customer.name, 'success');
}

// ===== EDIT CUSTOMER =====
function openEditCustomer(id, e) {
  if (e) e.stopPropagation();
  const c = DB.customers.find(x => x.id === id);
  if (!c) return;
  document.getElementById('edit-customer-id').value = id;
  document.getElementById('edit-nc-name').value = c.name;
  document.getElementById('edit-nc-phone').value = c.phone || '';
  document.getElementById('edit-customer-error').style.display = 'none';
  document.getElementById('edit-customer-modal').classList.add('open');
}

function confirmEditCustomer() {
  const id = document.getElementById('edit-customer-id').value;
  const name = document.getElementById('edit-nc-name').value.trim();
  const rawPhone = document.getElementById('edit-nc-phone').value.trim();
  const errEl = document.getElementById('edit-customer-error');
  errEl.style.display = 'none';

  if (!name) { errEl.textContent = 'Ism bo\'sh bo\'lishi mumkin emas'; errEl.style.display='block'; return; }

  const phoneResult = validatePhoneField(rawPhone);
  if (!phoneResult.ok) { errEl.textContent = phoneResult.msg; errEl.style.display='block'; return; }

  const dup = isNameOrPhoneDuplicate(name, phoneResult.value, id);
  if (dup) { errEl.textContent = `"${dup.name}" — bu ism yoki telefon boshqa mijozda mavjud!`; errEl.style.display='block'; return; }

  const idx = DB.customers.findIndex(c => c.id === id);
  if (idx >= 0) { DB.customers[idx].name = name; DB.customers[idx].phone = phoneResult.value; }
  save();
  document.getElementById('edit-customer-modal').classList.remove('open');
  renderCustomerList();
  if (analyticsCustomer === id) renderCustomerDetail(id);
  showToast('Mijoz yangilandi', 'success');
}

function selectCustomer(id) {
  selectedCustomer = DB.customers.find(c => c.id === id);
  document.getElementById('search-results').style.display = 'none';
  document.getElementById('new-customer-warn').style.display = 'none';
  document.getElementById('customer-search-wrap').style.display = 'none';

  const chip = document.getElementById('customer-selected');
  chip.style.display = 'block';
  chip.innerHTML = `
    <div class="customer-chip fade-in">
      <div class="avatar">${selectedCustomer.name[0].toUpperCase()}</div>
      <div class="info">
        <div class="cname">${selectedCustomer.name}</div>
        <div class="cphone">${selectedCustomer.phone || 'Telefon yo\'q'}</div>
      </div>
      <button class="chip-clear" onclick="clearCustomer()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
}

function clearCustomer() {
  selectedCustomer = null;
  document.getElementById('customer-selected').style.display = 'none';
  document.getElementById('customer-search-wrap').style.display = 'block';
  document.getElementById('customer-search').value = '';
}

// ===== TRANSACTION TYPE =====
function setType(t) {
  txnType = t;
  const txnCard = document.getElementById('txn-card');
  const amountLabel = document.getElementById('amount-label');
  const rateLabel = document.getElementById('rate-label');
  const convertedLabel = document.getElementById('converted-label');

  document.getElementById('btn-won').className = 'type-btn' + (t === 'won' ? ' active-won' : '');
  document.getElementById('btn-usd').className = 'type-btn' + (t === 'usd' ? ' active-usd' : '');

  if (t === 'won') {
    amountLabel.textContent = 'Olingan WON';
    rateLabel.textContent = 'Olingan kurs';
    convertedLabel.textContent = 'Auto USD';
    txnCard.classList.add('mode-won-red');
    txnCard.classList.remove('mode-usd-green');
  } else {
    amountLabel.textContent = 'Olingan Dollar';
    rateLabel.textContent = 'Sotilgan kurs';
    convertedLabel.textContent = 'Auto WON';
    txnCard.classList.add('mode-usd-green');
    txnCard.classList.remove('mode-won-red');
  }

  updateConversionPreview();
}

// ===== MANUAL ENTRY HELPERS =====
function updateConversionPreview() {
  const amount = parseFloat(document.getElementById('amount-input').value) || 0;
  const rate = parseFloat(document.getElementById('rate-input').value) || 0;
  const convertedLabel = document.getElementById('converted-label');
  const convertedOutput = document.getElementById('converted-output');

  if (!amount || !rate) {
    convertedOutput.value = '';
    return;
  }

  const converted = txnType === 'won' ? amount / rate : amount * rate;
  if (txnType === 'won') {
    convertedOutput.value = converted.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' $';
  } else {
    convertedOutput.value = Math.round(converted).toLocaleString() + ' ₩';
  }

}

// ===== SAVE TRANSACTION =====
function saveTransaction() {
  if (!selectedCustomer) { showToast('Mijozni tanlang!', 'error'); return; }
  const amount = parseFloat(document.getElementById('amount-input').value);
  const rate = parseFloat(document.getElementById('rate-input').value);
  if (!amount || !rate) { showToast('Miqdor va kursni kiriting!', 'error'); return; }
  const datetime = document.getElementById('datetime-input').value ||
    new Date().toISOString().slice(0, 16);

  const txn = {
    id: 't_' + Date.now(),
    customerId: selectedCustomer.id,
    type: txnType,
    direction: 'oldi/sotdi',
    amount, rate,
    convertedAmount: txnType === 'won' ? amount / rate : amount * rate,
    note: document.getElementById('note-input').value,
    datetime,
    createdAt: new Date().toISOString()
  };

  DB.transactions.push(txn);
  lastSavedTransaction = txn;
  save();
  showToast('Tranzaksiya saqlandi', 'success');
  resetForm();
}

function resetForm() {
  clearCustomer();
  setType('won');
  document.getElementById('amount-input').value = '';
  document.getElementById('rate-input').value = '';
  document.getElementById('note-input').value = '';
  document.getElementById('converted-output').value = '';
  setNow();
}

function setNow() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  document.getElementById('datetime-input').value = local;
}

// ===== HELPERS =====
function getTxnProfit(t) {
  if (Number.isFinite(Number(t.profit))) return Number(t.profit);
  return 0;
}

function getTxnExpense(t) {
  return 0;
}

function getTxnNet(t) {
  return getTxnProfit(t) - getTxnExpense(t);
}

function fmtAmount(a, type) {
  if (type === 'won') return Math.round(a).toLocaleString() + ' ₩';
  return a.toLocaleString() + ' $';
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('uz', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  setTimeout(() => t.className = '', 2500);
}

// ===== 3D PIE CHART =====
function initAnalytics() {
  renderAnalyticsStats();
  renderCustomerList();
  init3DChart();
}

function renderAnalyticsStats() {
  let totalProfit = 0, totalWon = 0, totalUsd = 0;
  DB.transactions.forEach(t => {
    if (t.type === 'won') totalWon += t.amount;
    if (t.type === 'usd') totalUsd += t.amount;
  });
  DB.profits.forEach(p => {
    if (p.currency === 'won') totalProfit += p.amount;
    else totalProfit += p.amount * 1350;
  });

  let totalExp = 0, totalExpUsd = 0;
  DB.expenses.forEach(e => {
    if (e.currency === 'won') totalExp += e.amount;
    else totalExpUsd += e.amount;
  });

  document.getElementById('total-profit-stat').textContent = totalProfit.toLocaleString() + ' ₩';
  document.getElementById('total-expense-stat').textContent = totalExp.toLocaleString() + ' ₩';
  document.getElementById('total-won-stat').textContent = totalWon.toLocaleString() + ' ₩';
  document.getElementById('total-usd-stat').textContent = totalUsd.toLocaleString() + ' $';
}

function getCustomerStats(cid) {
  const txns = DB.transactions.filter(t => t.customerId === cid);
  let wonIn = 0, usdIn = 0;
  txns.forEach(t => {
    if (t.type === 'won') wonIn += t.amount;
    if (t.type === 'usd') usdIn += t.amount;
  });
  return { wonIn, usdIn, txnCount: txns.length };
}

function init3DChart() {
  const container = document.getElementById('chart-container');
  const canvas = document.getElementById('chart-canvas');

  if (renderer) {
    cancelAnimationFrame(animFrameId);
    renderer.dispose();
  }

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 3.5, 5);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(3, 5, 5);
  scene.add(dirLight);
  const pointLight = new THREE.PointLight(0xf0c040, 0.8, 20);
  pointLight.position.set(-3, 3, 0);
  scene.add(pointLight);

  buildPieChart(analyticsCustomer);

  function animate() {
    animFrameId = requestAnimationFrame(animate);
    if (pieGroup) pieGroup.rotation.y += 0.005;
    renderer.render(scene, camera);
  }
  animate();
}

function buildPieChart(customerId) {
  if (pieGroup) scene.remove(pieGroup);
  pieGroup = new THREE.Group();
  scene.add(pieGroup);

  let rawData = [];
  if (customerId) {
    const stats = getCustomerStats(customerId);
    rawData = [
      { label: 'WON aylanma', value: stats.wonIn,            color: 0xf0c040 },
      { label: 'USD aylanma', value: stats.usdIn * 1350,     color: 0x30e09a },
    ];
  } else {
    let totalWon = 0, totalUsd = 0, totalProfit = 0;
    DB.transactions.forEach(t => {
      if (t.type === 'won') totalWon += t.amount;
      if (t.type === 'usd') totalUsd += t.amount * 1350;
    });
    DB.profits.forEach(p => {
      totalProfit += p.currency === 'won' ? p.amount : p.amount * 1350;
    });
    rawData = [
      { label: 'WON',    value: totalWon,    color: 0xf0c040 },
      { label: 'USD (₩)',value: totalUsd,    color: 0x30e09a },
      { label: 'Foyda',  value: totalProfit, color: 0x4090f0 },
    ];
  }

  // ← KEY FIX: strictly remove zero/negative values before rendering
  const data = rawData.filter(d => d.value > 0);

  if (data.length === 0) {
    data.push({ label: 'Ma\'lumot yo\'q', value: 1, color: 0x2a2a45 });
  }

  const total = data.reduce((s, d) => s + d.value, 0);
  const PIE_R = 2.1;      // radius
  const HEIGHT = 0.85;    // taller slices → more visible
  const GAP = 0.022;      // angular gap between slices (radians)
  let startAngle = -Math.PI / 2; // start from top

  const legend = document.getElementById('chart-legend');
  legend.innerHTML = '';

  data.forEach((d, i) => {
    const fullAngle = (d.value / total) * Math.PI * 2;
    // subtract gap on each side so slices never touch
    const sliceAngle = Math.max(fullAngle - GAP * 2, 0.01);
    const gappedStart = startAngle + GAP;
    const mid = gappedStart + sliceAngle / 2;

    const segments = Math.max(Math.ceil(sliceAngle * 24), 4);

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    for (let s = 0; s <= segments; s++) {
      const a = gappedStart + (s / segments) * sliceAngle;
      shape.lineTo(Math.cos(a) * PIE_R, Math.sin(a) * PIE_R);
    }
    shape.lineTo(0, 0);

    const extrudeSettings = {
      depth: HEIGHT,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.03,
      bevelSegments: 3
    };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    // Emissive glow so small slices stay vivid
    const material = new THREE.MeshPhongMaterial({
      color: d.color,
      emissive: new THREE.Color(d.color).multiplyScalar(0.18),
      shininess: 100,
      specular: new THREE.Color(0x888888),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;

    // Push slice outward from centre for clear gap effect
    const outset = 0.12;
    mesh.position.set(Math.cos(mid) * outset, i * 0.012, Math.sin(mid) * outset);

    pieGroup.add(mesh);
    startAngle += fullAngle;

    // Legend — bigger, bolder
    const pct = Math.round(d.value / total * 100);
    const pctExact = (d.value / total * 100).toFixed(1);
    const colorHex = '#' + d.color.toString(16).padStart(6, '0');
    legend.innerHTML += `
      <div class="legend-item" style="flex-direction:column;align-items:flex-start;gap:2px;flex:1;min-width:80px">
        <div style="display:flex;align-items:center;gap:7px">
          <div class="legend-dot" style="background:${colorHex};width:13px;height:13px;border-radius:3px;flex-shrink:0"></div>
          <span style="font-size:13px;font-weight:600;color:var(--text)">${d.label}</span>
        </div>
        <span style="font-size:20px;font-family:'Space Mono',monospace;font-weight:700;color:${colorHex};padding-left:20px">${pct}%</span>
        <span style="font-size:10px;color:var(--text3);padding-left:20px">${(d.value/1000000).toFixed(2)}M ₩</span>
      </div>`;
  });

  pieGroup.rotation.x = 0.25;
}

function renderCustomerList() {
  const container = document.getElementById('customers-scroll');
  if (DB.customers.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="es-icon">👥</div><div class="es-text">Mijozlar yo\'q</div></div>';
    return;
  }

  container.innerHTML = DB.customers.map(c => {
    const stats = getCustomerStats(c.id);
    return `
    <div class="customer-row ${analyticsCustomer === c.id ? 'active' : ''}" onclick="selectAnalyticsCustomer('${c.id}')">
      <div class="cr-avatar">${c.name[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div class="cr-name">${c.name}</div>
        <div class="cr-count">${stats.txnCount} tranzaksiya</div>
      </div>
      <button onclick="openEditCustomer('${c.id}', event)" style="background:none;border:1px solid var(--border);color:var(--text3);border-radius:7px;padding:5px 9px;cursor:pointer;font-size:11px;margin-left:6px;flex-shrink:0" title="Tahrirlash">✎</button>
    </div>`;
  }).join('');
}

function selectAnalyticsCustomer(cid) {
  analyticsCustomer = cid;
  renderCustomerList();
  buildPieChart(cid);
  renderCustomerDetail(cid);
}

function renderCustomerDetail(cid) {
  const cust = DB.customers.find(c => c.id === cid);
  if (!cust) return;
  const stats = getCustomerStats(cid);
  const txns = DB.transactions.filter(t => t.customerId === cid).sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

  const area = document.getElementById('customer-detail-area');
  area.innerHTML = `
    <div class="customer-detail fade-in">
      <div class="detail-name">${cust.name}</div>
      <div class="detail-phone">${cust.phone || 'Tel yo\'q'} · Mijoz ${fmtDate(cust.createdAt)}</div>
      <div class="detail-grid">
        <div class="detail-item">
          <div class="dl">WON aylanma</div>
          <div class="dv" style="color:var(--won)">${Math.round(stats.wonIn).toLocaleString()} ₩</div>
        </div>
        <div class="detail-item">
          <div class="dl">USD aylanma</div>
          <div class="dv" style="color:var(--usd)">${stats.usdIn.toLocaleString()} $</div>
        </div>
        <div class="detail-item">
          <div class="dl">Tranzaksiyalar</div>
          <div class="dv">${stats.txnCount}</div>
        </div>
      </div>
      <div class="trans-history">
        <div class="th-title">TRANZAKSIYALAR TARIXI</div>
        ${txns.length === 0 ? '<div style="color:var(--text3);font-size:13px">Hali tranzaksiya yo\'q</div>' :
          txns.map(t => `
            <div class="trans-item">
              <div class="trans-icon ${t.type === 'won' ? 'ti-won' : 'ti-usd'}">${t.type === 'won' ? '₩' : '$'}</div>
              <div class="trans-info">
                <div class="trans-main">${fmtAmount(t.amount, t.type)} · kurs ${t.rate}</div>
                <div class="trans-date">${fmtDate(t.datetime)}</div>
              </div>
              <div>
                <div class="trans-profit">${t.type === 'won' ? `${(t.convertedAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} $` : `${Math.round(t.convertedAmount || 0).toLocaleString()} ₩`}</div>
              </div>
            </div>`).join('')}
      </div>
    </div>`;
}

// ===== EXPENSES =====
function openExpenseModal() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  document.getElementById('exp-date').value = local;
  document.getElementById('expense-modal').classList.add('open');
}
function closeExpenseModal() {
  document.getElementById('expense-modal').classList.remove('open');
}

function saveExpense() {
  const desc = document.getElementById('exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('exp-amount').value);
  const currency = document.getElementById('exp-currency').value;
  const cat = document.getElementById('exp-cat').value.trim() || 'Boshqa';
  const date = document.getElementById('exp-date').value;

  if (!desc || !amount) { showToast('Tavsif va miqdorni kiriting!', 'error'); return; }

  const localItem = { id: 'e_' + Date.now(), desc, amount, currency, cat, date, createdAt: new Date().toISOString() };

  const commitLocal = item => {
    DB.expenses.push(item);
    save();
    closeExpenseModal();
    renderExpenses();
    refreshReportsPageIfOpen();
    showToast('Rasxod saqlandi', 'success');
    document.getElementById('exp-desc').value = '';
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-cat').value = '';
  };

  if (authSession && navigator.onLine) {
    apiRequest('/api/reports/expenses', {
      method: 'POST',
      body: JSON.stringify(toReportEntryPayload(localItem))
    }).then(response => {
      commitLocal(mapServerReportItem(response, 'e'));
      syncReportDataFromServer();
    }).catch(() => {
      commitLocal(localItem);
    });
    return;
  }

  commitLocal(localItem);
}

function getFilteredReportRows(rows) {
  const month = getReportMonth();
  return rows.filter(row => isRecordInSelectedMonth(row, month));
}

function renderWeekSummary(containerId, rows, toneColor) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const weeks = buildFourWeekSummary(rows);
  if (weeks.length === 0) {
    container.innerHTML = '<div class="stat-card"><div class="stat-label">Ma\'lumot yo\'q</div><div class="stat-value">0 ₩</div></div>';
    return;
  }

  container.innerHTML = weeks.map(item => `
    <div class="stat-card">
      <div class="stat-label">Hafta ${item.week}</div>
      <div class="stat-value" style="color:${toneColor}">${formatReportMoney(item.wonEquivalent)} ₩</div>
      <div class="stat-sub">W:${formatReportMoney(item.wonTotal)} · $:${item.usdTotal.toLocaleString()} · ${item.count} ta</div>
    </div>
  `).join('');
}

function renderReportsPage() {
  setReportMonth(reportMonth, true);

  renderReportsOverview();

  if (navigator.onLine) {
    syncReportDataFromServer().then(() => {
      if (document.getElementById('page-reports')?.classList.contains('active')) {
        renderReportsOverview();
      }
    });
  }
}

function renderReportsOverview() {
  const expenseRows = getFilteredReportRows(DB.expenses);
  const profitRows = getFilteredReportRows(DB.profits);
  const expenseWon = expenseRows.filter(row => row.currency === 'won').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const expenseUsd = expenseRows.filter(row => row.currency === 'usd').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const profitWon = profitRows.filter(row => row.currency === 'won').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const profitUsd = profitRows.filter(row => row.currency === 'usd').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  const expenseWonEq = expenseWon + (expenseUsd * 1350);
  const profitWonEq = profitWon + (profitUsd * 1350);
  const netWonEq = profitWonEq - expenseWonEq;

  const expenseTotal = document.getElementById('report-expense-total');
  const profitTotal = document.getElementById('report-profit-total');
  const netTotal = document.getElementById('report-net-total');
  const rowCount = document.getElementById('report-row-count');
  const reportMonthTitle = document.getElementById('report-month-title');

  if (expenseTotal) expenseTotal.textContent = `${formatReportMoney(expenseWonEq)} ₩`;
  if (profitTotal) profitTotal.textContent = `${formatReportMoney(profitWonEq)} ₩`;
  if (netTotal) netTotal.textContent = `${formatReportMoney(netWonEq)} ₩`;
  if (rowCount) rowCount.textContent = `${expenseRows.length + profitRows.length} ta yozuv`;
  if (reportMonthTitle) reportMonthTitle.textContent = reportMonth;

  renderWeekSummary('report-exp-week-summary', expenseRows, 'var(--red)');
  renderWeekSummary('report-profit-week-summary', profitRows, 'var(--green)');
}

function refreshReportsPageIfOpen() {
  const page = document.getElementById('page-reports');
  if (page && page.classList.contains('active')) {
    renderReportsPage();
  }
}

function renderExpenses() {
  const list = document.getElementById('expense-list');
  const reportRows = getFilteredReportRows(DB.expenses);
  if (reportRows.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="es-icon">💸</div><div class="es-text">Rasxodlar yo\'q</div></div>';
  } else {
    const sorted = [...reportRows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    list.innerHTML = sorted.map(e => `
      <div class="expense-item">
        <div class="ex-icon">💸</div>
        <div class="ex-info">
          <div class="ex-desc">${e.desc}</div>
          <div class="ex-date">${fmtDate(e.date)} · ${e.cat}</div>
        </div>
        <div class="ex-amount">-${e.amount.toLocaleString()} ${e.currency === 'won' ? '₩' : '$'}</div>
      </div>`).join('');
  }

  // Summary
  let totalWon = 0, totalUsd = 0;
  const cats = {};
  reportRows.forEach(e => {
    if (e.currency === 'won') totalWon += e.amount; else totalUsd += e.amount;
    cats[e.cat] = (cats[e.cat] || 0) + (e.currency === 'won' ? e.amount : e.amount * 1350);
  });
  document.getElementById('exp-total-won').textContent = totalWon.toLocaleString() + ' ₩';
  document.getElementById('exp-total-usd').textContent = totalUsd.toLocaleString() + ' $';
  const catDiv = document.getElementById('exp-by-category');
  catDiv.innerHTML = Object.entries(cats).sort((a,b) => b[1]-a[1]).map(([k, v]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:14px">${k}</span>
      <span style="font-size:13px;font-family:'Space Mono',monospace;color:var(--red)">${Math.round(v).toLocaleString()} ₩</span>
    </div>`).join('');

  renderWeekSummary('exp-week-summary', reportRows, 'var(--red)');
}

function switchExpTab(t) {
  document.getElementById('exp-tab-list').style.display = t === 'list' ? 'block' : 'none';
  document.getElementById('exp-tab-summary').style.display = t === 'summary' ? 'block' : 'none';
  document.getElementById('etab-list').className = 'itab' + (t === 'list' ? ' active' : '');
  document.getElementById('etab-summary').className = 'itab' + (t === 'summary' ? ' active' : '');
}

// ===== PROFITS =====
function openProfitModal() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  document.getElementById('profit-date').value = local;
  document.getElementById('profit-modal').classList.add('open');
}

function closeProfitModal() {
  document.getElementById('profit-modal').classList.remove('open');
}

function saveProfit() {
  const desc = document.getElementById('profit-desc').value.trim();
  const amount = parseFloat(document.getElementById('profit-amount').value);
  const currency = document.getElementById('profit-currency').value;
  const cat = document.getElementById('profit-cat').value.trim() || 'Boshqa';
  const date = document.getElementById('profit-date').value;

  if (!desc || !amount) { showToast('Tavsif va miqdorni kiriting!', 'error'); return; }

  const localItem = { id: 'p_' + Date.now(), desc, amount, currency, cat, date, createdAt: new Date().toISOString() };

  const commitLocal = item => {
    DB.profits.push(item);
    save();
    closeProfitModal();
    renderProfits();
    refreshReportsPageIfOpen();
    showToast('Foyda saqlandi', 'success');
    document.getElementById('profit-desc').value = '';
    document.getElementById('profit-amount').value = '';
    document.getElementById('profit-cat').value = '';
  };

  if (authSession && navigator.onLine) {
    apiRequest('/api/reports/profits', {
      method: 'POST',
      body: JSON.stringify(toReportEntryPayload(localItem))
    }).then(response => {
      commitLocal(mapServerReportItem(response, 'p'));
      syncReportDataFromServer();
    }).catch(() => {
      commitLocal(localItem);
    });
    return;
  }

  commitLocal(localItem);
}

function renderProfits() {
  const list = document.getElementById('profit-list');
  if (!list) return;
  const reportRows = getFilteredReportRows(DB.profits);

  if (reportRows.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="es-icon">📈</div><div class="es-text">Foydalar yo\'q</div></div>';
  } else {
    const sorted = [...reportRows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    list.innerHTML = sorted.map(p => `
      <div class="expense-item">
        <div class="ex-icon" style="background:rgba(48,224,154,.12)">📈</div>
        <div class="ex-info">
          <div class="ex-desc">${p.desc}</div>
          <div class="ex-date">${fmtDate(p.date)} · ${p.cat}</div>
        </div>
        <div class="ex-amount" style="color:var(--green)">+${p.amount.toLocaleString()} ${p.currency === 'won' ? '₩' : '$'}</div>
      </div>`).join('');
  }

  let totalWon = 0, totalUsd = 0;
  const cats = {};
  reportRows.forEach(p => {
    if (p.currency === 'won') totalWon += p.amount; else totalUsd += p.amount;
    cats[p.cat] = (cats[p.cat] || 0) + (p.currency === 'won' ? p.amount : p.amount * 1350);
  });

  document.getElementById('profit-total-won').textContent = totalWon.toLocaleString() + ' ₩';
  document.getElementById('profit-total-usd').textContent = totalUsd.toLocaleString() + ' $';
  const catDiv = document.getElementById('profit-by-category');
  catDiv.innerHTML = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:14px">${k}</span>
      <span style="font-size:13px;font-family:'Space Mono',monospace;color:var(--green)">${Math.round(v).toLocaleString()} ₩</span>
    </div>`).join('');

  renderWeekSummary('profit-week-summary', reportRows, 'var(--green)');
}

function switchProfitTab(t) {
  document.getElementById('profit-tab-list').style.display = t === 'list' ? 'block' : 'none';
  document.getElementById('profit-tab-summary').style.display = t === 'summary' ? 'block' : 'none';
  document.getElementById('ptab-list').className = 'itab' + (t === 'list' ? ' active' : '');
  document.getElementById('ptab-summary').className = 'itab' + (t === 'summary' ? ' active' : '');
}

function toExcelReportItem(item) {
  return {
    id: item.id,
    description: item.desc,
    amount: Number(item.amount) || 0,
    currency: item.currency,
    category: item.cat,
    date: item.date || '',
    createdAt: item.createdAt || ''
  };
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function exportReportWorkbook() {
  if (!authSession) {
    showToast('Avval tizimga kiring', 'error');
    return;
  }

  const month = getReportMonth();

  try {
    if (!navigator.onLine) {
      throw new Error('Offline holatda Excel export ishlamaydi.');
    }

    const blob = await apiRequestBlob(`/api/reports/excel/export?month=${encodeURIComponent(month)}`, {
      method: 'GET'
    });
    downloadBlob(blob, `report_${month}.xlsx`);
    showToast('Excel eksport tayyor', 'success');
  } catch (e) {
    showToast('Excel export xato: ' + e.message, 'error');
  }
}

function triggerReportImport() {
  if (!authSession) {
    showToast('Avval tizimga kiring', 'error');
    return;
  }

  document.getElementById('report-import-input').value = '';
  document.getElementById('report-import-input').click();
}

async function handleReportImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!authSession || !navigator.onLine) {
    showToast('Excel import uchun faol ulanish kerak', 'error');
    return;
  }

  if (!window.confirm('Excel fayldagi expenses/profits joriy ma\'lumotlarni almashtiradi. Davom etilsinmi?')) {
    return;
  }

  const formData = new FormData();
  formData.append('workbook', file);

  try {
    const response = await apiRequestFormData('/api/reports/excel/import', formData);
    if (!response || !Array.isArray(response.expenses) || !Array.isArray(response.profits)) {
      throw new Error('Invalid import payload');
    }

    DB.expenses = response.expenses.map(item => mapServerReportItem(item, 'e'));
    DB.profits = response.profits.map(item => mapServerReportItem(item, 'p'));

    if (response.month) {
      setReportMonth(response.month, true);
    }

    save();
    renderExpenses();
    renderProfits();
    renderAnalyticsStats();
    showToast('Excel import muvaffaqiyatli', 'success');
  } catch (e) {
    showToast('Excel import xato: ' + e.message, 'error');
  } finally {
    event.target.value = '';
  }
}

// ===== MOCK DATA (only if DB is empty) =====
function loadMockData() {
  if (DB.customers.length > 0) return;

  const customers = [
    { id: 'c_001', name: 'Alisher Karimov',  phone: '+998 90 123 45 67', createdAt: '2026-02-01T09:00:00' },
    { id: 'c_002', name: 'Bobur Toshmatov',  phone: '+998 91 234 56 78', createdAt: '2026-02-05T11:00:00' },
    { id: 'c_003', name: 'Dilnoza Yusupova', phone: '+998 93 345 67 89', createdAt: '2026-02-10T14:00:00' },
    { id: 'c_004', name: 'Jamshid Rakhimov', phone: '+998 94 456 78 90', createdAt: '2026-02-15T10:00:00' },
    { id: 'c_005', name: 'Kamola Nazarova',  phone: '',                  createdAt: '2026-02-20T16:00:00' },
  ];

  // Transactions
  const transactions = [
    { id: 't_001', customerId: 'c_001', type: 'won', direction: 'oldi/sotdi', amount: 2000000, rate: 1340, convertedAmount: 1492.54, note: '', datetime: '2026-02-10T10:00', createdAt: '2026-02-10T10:00:00' },
    { id: 't_002', customerId: 'c_001', type: 'usd', direction: 'oldi/sotdi', amount: 800, rate: 1368, convertedAmount: 1094400, note: 'tez kerak edi', datetime: '2026-02-21T11:00', createdAt: '2026-02-21T11:00:00' },
    { id: 't_003', customerId: 'c_002', type: 'usd', direction: 'oldi/sotdi', amount: 500, rate: 1355, convertedAmount: 677500, note: '', datetime: '2026-03-05T14:00', createdAt: '2026-03-05T14:00:00' },
    { id: 't_004', customerId: 'c_003', type: 'won', direction: 'oldi/sotdi', amount: 5000000, rate: 1345, convertedAmount: 3717.47, note: '', datetime: '2026-02-18T11:00', createdAt: '2026-02-18T11:00:00' },
    { id: 't_005', customerId: 'c_004', type: 'usd', direction: 'oldi/sotdi', amount: 300, rate: 1358, convertedAmount: 407400, note: '', datetime: '2026-03-08T10:00', createdAt: '2026-03-08T10:00:00' },
    { id: 't_006', customerId: 'c_005', type: 'won', direction: 'oldi/sotdi', amount: 1360000, rate: 1360, convertedAmount: 1000, note: '', datetime: '2026-03-02T11:00', createdAt: '2026-03-02T11:00:00' },
  ];

  const profits = [
    { id: 'p_001', desc: 'Kunlik savdo foydasi', amount: 30000, currency: 'won', cat: 'Savdo', date: '2026-02-10T16:00', createdAt: '2026-02-10T16:00:00' },
    { id: 'p_002', desc: 'Komissiya', amount: 45, currency: 'usd', cat: 'Komissiya', date: '2026-02-20T19:00', createdAt: '2026-02-20T19:00:00' },
  ];

  const expenses = [
    { id: 'e_001', desc: 'Ofis ijarasi', amount: 800000, currency: 'won', cat: 'Ijara', date: '2026-02-01T09:00', createdAt: '2026-02-01T09:00:00' },
    { id: 'e_002', desc: 'Telefon tarifi', amount: 30000, currency: 'won', cat: 'Kommunikatsiya', date: '2026-02-05T10:00', createdAt: '2026-02-05T10:00:00' },
    { id: 'e_003', desc: 'Yordamchi maoshi', amount: 200, currency: 'usd', cat: 'Maosh', date: '2026-02-28T17:00', createdAt: '2026-02-28T17:00:00' },
    { id: 'e_004', desc: 'Ofis ijarasi', amount: 800000, currency: 'won', cat: 'Ijara', date: '2026-03-01T09:00', createdAt: '2026-03-01T09:00:00' },
    { id: 'e_005', desc: 'Transport', amount: 15000, currency: 'won', cat: 'Transport', date: '2026-03-05T08:00', createdAt: '2026-03-05T08:00:00' },
  ];

  DB.customers = customers;
  DB.transactions = transactions;
  DB.expenses = expenses;
  DB.profits = profits;
  save();
}

// ===== INPUT EVENTS =====
document.getElementById('amount-input').addEventListener('input', updateConversionPreview);
document.getElementById('rate-input').addEventListener('input', updateConversionPreview);
document.getElementById('report-month-input').addEventListener('change', e => setReportMonth(e.target.value));
document.getElementById('notify-worker-select').addEventListener('change', updateNotifyPreview);
document.getElementById('notify-customer-select').addEventListener('change', onNotifyCustomerChange);
document.getElementById('notify-transaction-select').addEventListener('change', updateNotifyPreview);
document.getElementById('report-import-input').addEventListener('change', handleReportImportFile);
document.addEventListener('click', e => {
  const sr = document.getElementById('search-results');
  if (!e.target.closest('#customer-search') && !e.target.closest('#search-results')) {
    sr.style.display = 'none';
  }
});

loadMockData();

// ===== INIT =====
setNow();
updateConversionPreview();
if (localStorage.getItem(REPORT_MONTH_KEY)) {
  setReportMonth(reportMonth, true);
} else {
  setReportMonth(getLatestReportMonthFromData(), true);
}
checkExistingSession();
setupInviteRegistrationMode();
registerVipServiceWorker();

// Close modals on overlay click
document.getElementById('expense-modal').addEventListener('click', function(e) {
  if (e.target === this) closeExpenseModal();
});
document.getElementById('new-customer-modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});
document.getElementById('edit-customer-modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});
document.getElementById('profit-modal').addEventListener('click', function(e) {
  if (e.target === this) closeProfitModal();
});
document.getElementById('notify-modal').addEventListener('click', function(e) {
  if (e.target === this) closeNotifyModal();
});
window.addEventListener('online', () => {
  flushNotifyOutbox();
});
