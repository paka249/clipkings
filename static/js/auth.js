'use strict';

function authToken() { return localStorage.getItem('sf-auth-token') || ''; }

// Drop-in fetch wrapper — auto-injects Bearer token, redirects to /auth on 401
async function apiFetch(url, opts = {}) {
  const token = authToken();
  const headers = new Headers(opts.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', 'Bearer ' + token);
  }
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    localStorage.removeItem('sf-auth-token');
    localStorage.removeItem('sf-auth-user');
    window.location.replace('/auth');
  }
  return res;
}

async function checkAuth() {
  const token = authToken();
  if (!token) return;
  try {
    const res = await apiFetch('/api/auth/me');
    if (!res.ok) {
      localStorage.removeItem('sf-auth-token');
      localStorage.removeItem('sf-auth-user');
      return;
    }
    const user = await res.json();
    localStorage.setItem('sf-profile-name',  user.username);
    localStorage.setItem('sf-profile-email', user.email);
  } catch { /* offline — continue with cached profile */ }
}

async function logout() {
  const token = authToken();
  if (token) {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }
  localStorage.removeItem('sf-auth-token');
  localStorage.removeItem('sf-auth-user');
  window.location.replace('/auth');
}
