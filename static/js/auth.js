'use strict';

function authToken() { return localStorage.getItem('sf-auth-token') || ''; }

async function checkAuth() {
  const token = authToken();
  if (!token) return;
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
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
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    }).catch(() => {});
  }
  localStorage.removeItem('sf-auth-token');
  localStorage.removeItem('sf-auth-user');
  window.location.replace('/auth');
}
