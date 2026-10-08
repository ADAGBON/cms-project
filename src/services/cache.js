// Small in-process TTL cache for hot public reads (home page, sitemap, API lists).
// Any content write calls clear(), so readers never see stale data after an edit.
const store = new Map();
const stats = { hits: 0, misses: 0 };

async function remember(key, ttlMs, producer) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) {
    stats.hits += 1;
    return hit.value;
  }
  stats.misses += 1;
  const value = await producer();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

function clear() {
  store.clear();
}

function getStats() {
  const total = stats.hits + stats.misses;
  return { ...stats, entries: store.size, hitRate: total ? Math.round((stats.hits / total) * 100) : 0 };
}

module.exports = { remember, clear, getStats };
