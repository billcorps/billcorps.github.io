export const DEFAULT_SETTINGS = Object.freeze({ sound: true, music: true, haptics: true, reducedEffects: false });
const PREFIX = 'planet-removal.web.v1.';
const keyName = key => key === 'planet-removal.run.v1' ? 'save'
  : key === 'planet-removal.settings.v1' ? 'settings' : key;

// Storage can be unavailable in private sessions. Gameplay continues in memory.
export class BrowserStorage {
  constructor(storage) {
    if (storage === undefined) {
      try { storage = globalThis.localStorage; } catch { storage = null; }
    }
    this.storage = storage;
    this.memory = new Map();
    this.persistent = !!storage;
  }
  get(key) {
    key = keyName(key);
    if (this.memory.has(key)) return this.memory.get(key);
    try { return this.storage?.getItem(PREFIX + key) ?? this.memory.get(key) ?? null; }
    catch { this.persistent = false; return this.memory.get(key) ?? null; }
  }
  set(key, value) {
    key = keyName(key);
    this.memory.set(key, String(value));
    try { this.storage?.setItem(PREFIX + key, String(value)); }
    catch { this.persistent = false; }
  }
  remove(key) {
    key = keyName(key);
    this.memory.delete(key);
    try { this.storage?.removeItem(PREFIX + key); } catch { this.persistent = false; }
  }
  getItem(key) { return this.get(key); }
  setItem(key, value) { this.set(key, value); }
  removeItem(key) { this.remove(key); }
  readSettings() {
    let stored = {};
    try { stored = JSON.parse(this.get('settings') || '{}') || {}; } catch { /* Ignore corrupt preferences. */ }
    return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) =>
      [key, typeof stored[key] === 'boolean' ? stored[key] : fallback]));
  }
  writeSettings(settings) { this.set('settings', JSON.stringify(settings)); }
  readSave() { return this.get('save'); }
  writeSave(save) { if (save != null) this.set('save', save); }
}
