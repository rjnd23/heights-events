/**
 * storage.js
 * Drop-in replacement for the Claude artifact window.storage API.
 * Uses localStorage so it works in any browser or Capacitor mobile app.
 */

export async function loadStored(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveStored(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // localStorage can throw if storage quota exceeded
    console.warn('Storage quota exceeded, could not save:', key);
  }
}

export async function getStoredRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
