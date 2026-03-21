const API_BASE = localStorage.getItem('api_base') || 'http://localhost:5075';
const AUTH_KEY = 'worker_auth';
let session = null;

const authCard = document.getElementById('auth-card');
const actionCard = document.getElementById('action-card');
const authMsg = document.getElementById('auth-msg');
const saveMsg = document.getElementById('save-msg');

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
}

function clearSession() {
  session = null;
  localStorage.removeItem(AUTH_KEY);
  authCard.style.display = 'block';
  actionCard.style.display = 'none';
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
  } catch {
    clearSession();
  }
}

document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('save-btn').addEventListener('click', saveAction);
document.getElementById('logout-btn').addEventListener('click', clearSession);

restore();
