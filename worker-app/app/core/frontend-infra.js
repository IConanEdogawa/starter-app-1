(function (global) {
  const STORAGE_KEY = 'api_base';
  const DEFAULT_LOCAL_API = 'http://localhost:5075';

  function normalizeBase(url) {
    return String(url || '').trim().replace(/\/$/, '');
  }

  function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1';
  }

  function resolveApiBase() {
    const fromStorage = normalizeBase(localStorage.getItem(STORAGE_KEY));
    if (fromStorage) return fromStorage;

    const fromMeta = normalizeBase(document.querySelector('meta[name="api-base"]')?.getAttribute('content'));
    if (fromMeta) return fromMeta;

    if (isLocalHost(window.location.hostname)) {
      return DEFAULT_LOCAL_API;
    }

    return normalizeBase(window.location.origin);
  }

  function getApiBase() {
    return normalizeBase(localStorage.getItem(STORAGE_KEY));
  }

  function setApiBase(url) {
    const value = normalizeBase(url);
    if (!value) return;
    localStorage.setItem(STORAGE_KEY, value);
  }

  function clearApiBase() {
    localStorage.removeItem(STORAGE_KEY);
  }

  async function apiRequest(baseUrl, path, options) {
    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {});
    const token = opts.token;

    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }

    let body = opts.body;
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    if (!isFormData && body !== undefined && body !== null && typeof body !== 'string') {
      body = JSON.stringify(body);
    }

    if (!isFormData && body !== undefined && body !== null && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(baseUrl + path, {
      method: opts.method || 'GET',
      headers,
      body
    });

    const contentType = response.headers.get('content-type') || '';
    const parsed = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      const message = typeof parsed === 'string' ? parsed : (parsed?.title || parsed?.message || 'Server error');
      throw new Error(message);
    }

    return parsed;
  }

  global.KursInfra = {
    resolveApiBase,
    getApiBase,
    setApiBase,
    clearApiBase,
    apiRequest,
    isLocalHost
  };
})(window);
