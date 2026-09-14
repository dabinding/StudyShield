export class TtlLruCache {
  constructor({ maxEntries = 5000, now = Date.now } = {}) {
    this.maxEntries = Math.max(1, Number(maxEntries) || 5000);
    this.now = now;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Moving a hit to the end keeps the most recently used results in memory.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs) {
    const lifetime = Number(ttlMs);
    if (!Number.isFinite(lifetime) || lifetime <= 0) return;

    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + lifetime });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  delete(key) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
