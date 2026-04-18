'use strict';

/**
 * cache.js — In-memory LRU-style result cache
 *
 * Features:
 *  - TTL-based expiry (default 5 min)
 *  - Max-entry eviction (LRU order via insertion order + Map)
 *  - stats() for observability
 */

class QACache {
  /**
   * @param {{ ttlMs?: number, maxEntries?: number }} opts
   */
  constructor({ ttlMs = 5 * 60 * 1000, maxEntries = 100 } = {}) {
    this._ttlMs      = ttlMs;
    this._maxEntries = maxEntries;
    this._store      = new Map();  // key → { value, expiresAt }
    this._hits       = 0;
    this._misses     = 0;
  }

  /** Retrieve a cached value, or null if missing/expired. */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) { this._misses++; return null; }

    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      this._misses++;
      return null;
    }

    // Refresh insertion order (LRU touch)
    this._store.delete(key);
    this._store.set(key, entry);

    this._hits++;
    return entry.value;
  }

  /** Store a value. Evicts oldest entry if over capacity. */
  set(key, value) {
    // Evict expired first (cheap pass)
    this._evictExpired();

    // If still over cap, remove oldest (first in Map insertion order)
    while (this._store.size >= this._maxEntries) {
      const oldest = this._store.keys().next().value;
      this._store.delete(oldest);
    }

    this._store.set(key, {
      value,
      expiresAt: Date.now() + this._ttlMs,
    });
  }

  /** Remove specific key. */
  delete(key) {
    this._store.delete(key);
  }

  /** Clear all entries. */
  clear() {
    this._store.clear();
  }

  /** Observability snapshot. */
  stats() {
    this._evictExpired();
    return {
      size:        this._store.size,
      max_entries: this._maxEntries,
      ttl_ms:      this._ttlMs,
      hits:        this._hits,
      misses:      this._misses,
      hit_rate:    this._hits + this._misses > 0
                     ? `${((this._hits / (this._hits + this._misses)) * 100).toFixed(1)}%`
                     : 'n/a',
    };
  }

  _evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) this._store.delete(key);
    }
  }
}

module.exports = { QACache };
