// ===== DATA STORE =====
const AUTH_KEY = 'kurs_auth';
const API_BASE = localStorage.getItem('api_base') || 'http://localhost:5075';

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

// ===== STATE =====
let selectedCustomer = null;
let txnType = 'won';
let analyticsCustomer = null;
let scene, camera, renderer, pieGroup;
let animFrameId;
let authSession = null;

// ===== NAVIGATION =====
function switchPage(p) {
  if (!canAccessPage(p)) {
    showToast('Bu sahifa sizning role uchun yopiq', 'error');
    return;
  }
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('active'));
  document.getElementById('page-' + p).classList.add('active');
  document.getElementById('nav-' + p).classList.add('active');
  if (p === 'analytics') { setTimeout(initAnalytics, 50); }
  if (p === 'expenses') { renderExpenses(); }
  if (p === 'profits') { renderProfits(); }
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
    profits: document.getElementById('nav-profits')
  };

  if (role === 'worker') {
    navMap.analytics.style.display = 'none';
    navMap.expenses.style.display = 'none';
    navMap.profits.style.display = 'none';
    switchPage('txn');
    return;
  }

  navMap.analytics.style.display = '';
  navMap.expenses.style.display = '';
  navMap.profits.style.display = '';
}

function switchAuthTab(tab) {
  document.getElementById('auth-tab-login').className = 'auth-tab' + (tab === 'login' ? ' active' : '');
  document.getElementById('auth-tab-register').className = 'auth-tab' + (tab === 'register' ? ' active' : '');
  document.getElementById('auth-login-panel').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('auth-register-panel').style.display = tab === 'register' ? 'block' : 'none';
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
}

async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (authSession?.token) {
    headers.Authorization = `Bearer ${authSession.token}`;
  }

  const response = await fetch(API_BASE + path, {
    ...options,
    headers
  });

  let body = null;
  const isJson = response.headers.get('content-type')?.includes('application/json');
  if (isJson) body = await response.json();
  else body = await response.text();

  if (!response.ok) {
    const message = typeof body === 'string' ? body : (body?.title || body?.message || 'Server error');
    throw new Error(message);
  }
  return body;
}

async function registerUser() {
  const userName = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value.trim();
  const role = document.getElementById('register-role').value;

  if (!userName || !password) {
    showToast('Username va parol kiriting', 'error');
    return;
  }

  try {
    const payload = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ userName, password, role })
    });
    setAuthSession(payload);
    showToast('Ro\'yxatdan o\'tish muvaffaqiyatli', 'success');
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
  document.getElementById('btn-won').className = 'type-btn' + (t === 'won' ? ' active-won' : '');
  document.getElementById('btn-usd').className = 'type-btn' + (t === 'usd' ? ' active-usd' : '');
  document.getElementById('amount-label').textContent = t === 'won' ? 'Miqdor (WON)' : 'Miqdor (USD)';
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
    convertedLabel.textContent = 'Hisoblangan USD';
    convertedOutput.value = converted.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' $';
  } else {
    convertedLabel.textContent = 'Hisoblangan WON';
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

  DB.expenses.push({ id: 'e_' + Date.now(), desc, amount, currency, cat, date, createdAt: new Date().toISOString() });
  save();
  closeExpenseModal();
  renderExpenses();
  showToast('Rasxod saqlandi', 'success');
  document.getElementById('exp-desc').value = '';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-cat').value = '';
}

function renderExpenses() {
  const list = document.getElementById('expense-list');
  if (DB.expenses.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="es-icon">💸</div><div class="es-text">Rasxodlar yo\'q</div></div>';
  } else {
    const sorted = [...DB.expenses].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
  DB.expenses.forEach(e => {
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

  DB.profits.push({ id: 'p_' + Date.now(), desc, amount, currency, cat, date, createdAt: new Date().toISOString() });
  save();
  closeProfitModal();
  renderProfits();
  showToast('Foyda saqlandi', 'success');
  document.getElementById('profit-desc').value = '';
  document.getElementById('profit-amount').value = '';
  document.getElementById('profit-cat').value = '';
}

function renderProfits() {
  const list = document.getElementById('profit-list');
  if (!list) return;

  if (DB.profits.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="es-icon">📈</div><div class="es-text">Foydalar yo\'q</div></div>';
  } else {
    const sorted = [...DB.profits].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
  DB.profits.forEach(p => {
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
}

function switchProfitTab(t) {
  document.getElementById('profit-tab-list').style.display = t === 'list' ? 'block' : 'none';
  document.getElementById('profit-tab-summary').style.display = t === 'summary' ? 'block' : 'none';
  document.getElementById('ptab-list').className = 'itab' + (t === 'list' ? ' active' : '');
  document.getElementById('ptab-summary').className = 'itab' + (t === 'summary' ? ' active' : '');
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
checkExistingSession();

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
